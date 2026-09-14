import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { AGENT_BACKUP_TIMEOUT_MS } from "@/lib/agent/client"
import type { Queryer } from "@/lib/database"
import {
  acquireBackupLock,
  markBackupFailed,
  markBackupSuccess,
  MAX_COMPLETED_BACKUPS_PER_DATABASE,
  RECLAIM_SAFETY_MARGIN_MS,
  reclaimStaleBackups,
  STALE_BACKUP_LOCK_MS,
} from "@/lib/resources/backups"
import {
  createTestDatabase,
  createTestServer,
  createTestUser,
} from "@/test/fixtures"
import { testPool } from "@/test/testDatabase"
import { withTestTransaction } from "@/test/withTestTransaction"

/*
 * Attend, de façon déterministe, qu'un backend Postgres soit RÉELLEMENT
 * bloqué par un autre (pg_blocking_pids) — même technique que le test
 * de concurrence de deployments.test.ts (finding H1) : jamais un délai
 * arbitraire qui pourrait être trop court (faux négatif) ou inutile.
 */
async function waitUntilBlocked(pid: number, timeoutMs = 5_000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const result = await testPool.query<{ blocked: boolean }>(
      "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
      [pid],
    )

    if (result.rows[0].blocked) return

    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(
    `Timeout : le backend ${pid} n'a jamais été détecté comme bloqué par pg_blocking_pids().`,
  )
}

async function insertCompletedBackup(
  db: Queryer,
  databaseId: string,
  serverId: string,
) {
  await db.query(
    `
      INSERT INTO backups (database_id, server_id, filename, status, size_bytes)
      VALUES ($1, $2, $3, 'completed', 1000)
    `,
    [databaseId, serverId, `${randomUUID()}.sql.gz`],
  )
}

describe("Invariant timeout Agent / stale-lock Panel (finding M2)", () => {
  it("STALE_BACKUP_LOCK_MS reste strictement supérieur au budget total Agent", () => {
    expect(STALE_BACKUP_LOCK_MS).toBeGreaterThan(
      AGENT_BACKUP_TIMEOUT_MS,
    )
  })

  it("la marge de sécurité est exactement RECLAIM_SAFETY_MARGIN_MS (dérivation, pas un second nombre indépendant)", () => {
    expect(
      STALE_BACKUP_LOCK_MS - AGENT_BACKUP_TIMEOUT_MS,
    ).toBe(RECLAIM_SAFETY_MARGIN_MS)
  })
})

describe("acquireBackupLock", () => {
  it("aucun backup 'creating' -> création autorisée", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(result.response).toBeNull()
      expect(result.backupId).not.toBeNull()
    })
  })

  it("backup déjà 'creating' pour cette base -> 409, aucun deuxième backup créé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(first.response).toBeNull()

      /*
       * withTestTransaction partage UNE seule transaction — un
       * SAVEPOINT isole l'INSERT en échec attendu (même technique que
       * H1/deployments.test.ts).
       */
      await db.query("SAVEPOINT before_conflict")

      const second = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(second.backupId).toBeNull()
      expect(second.response?.status).toBe(409)

      const body = await second.response!.json()
      expect(body.message).toBe(
        "Une sauvegarde est déjà en cours pour cette base.",
      )

      await db.query("ROLLBACK TO SAVEPOINT before_conflict")

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM backups WHERE database_id = $1`,
        [database.id],
      )
      expect(countResult.rows[0].count).toBe("1")
    })
  })

  it("backup 'completed' -> le verrou est libéré, un nouveau backup est autorisé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(first.response).toBeNull()

      await markBackupSuccess(
        first.backupId!,
        { filename: "test.sql.gz", sizeBytes: 100 },
        db,
      )

      const second = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(second.response).toBeNull()
      expect(second.backupId).not.toBe(first.backupId)
    })
  })

  it("backup 'failed' -> le verrou est libéré, un nouveau backup est autorisé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(first.response).toBeNull()

      await markBackupFailed(
        first.backupId!,
        "Erreur de test.",
        db,
      )

      const second = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(second.response).toBeNull()
    })
  })

  it("un verrou 'creating' très ancien (crash/restart) est réclamé automatiquement, pas bloqué indéfiniment", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const staleCreatedAt = new Date(
        Date.now() - STALE_BACKUP_LOCK_MS - 60_000,
      )

      const staleResult = await db.query<{ id: string }>(
        `
          INSERT INTO backups (database_id, server_id, filename, status, created_at)
          VALUES ($1, $2, '', 'creating', $3)
          RETURNING id
        `,
        [database.id, server.id, staleCreatedAt],
      )
      const staleBackupId = staleResult.rows[0].id

      const result = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(result.response).toBeNull()
      expect(result.backupId).not.toBe(staleBackupId)

      const staleRow = await db.query<{ status: string }>(
        `SELECT status FROM backups WHERE id = $1`,
        [staleBackupId],
      )
      expect(staleRow.rows[0].status).toBe("failed")
    })
  })

  it("un verrou 'creating' récent (encore légitime) n'est PAS réclamé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(first.response).toBeNull()

      const second = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(second.backupId).toBeNull()
      expect(second.response?.status).toBe(409)
    })
  })

  it(
    "deux acquisitions réellement concurrentes (deux connexions Postgres distinctes) sur la même base -> une seule obtient le verrou",
    async () => {
      const email = `race-fixture-${randomUUID()}@fixtures.internal`
      const userResult = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
        [email, "Race Fixture"],
      )
      const userId = userResult.rows[0].id

      const suffix = randomUUID().slice(0, 8)
      const serverResult = await testPool.query<{ id: string }>(
        `INSERT INTO servers (name, hostname, status) VALUES ($1, $2, 'offline') RETURNING id`,
        [`race-server-${suffix}`, `race-${suffix}.test`],
      )
      const serverId = serverResult.rows[0].id

      const dbName = `race-db-${suffix}`
      const databaseResult = await testPool.query<{ id: string }>(
        `
          INSERT INTO databases (
            user_id, server_id, name, container_name, image,
            database_name, username, password_encrypted,
            internal_host, internal_port
          )
          VALUES ($1, $2, $3, $4, 'postgres:16-alpine', $5, $6, 'x', $7, 5432)
          RETURNING id
        `,
        [
          userId,
          serverId,
          dbName,
          `hosting-db-${dbName}`,
          dbName.replace(/-/g, "_"),
          `${dbName.replace(/-/g, "_")}_user`,
          `hosting-db-${dbName}`,
        ],
      )
      const databaseId = databaseResult.rows[0].id

      try {
        const clientA = await testPool.connect()
        const clientB = await testPool.connect()

        try {
          await clientA.query("BEGIN")
          await clientB.query("BEGIN")

          const pidBResult = await clientB.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          )
          const pidB = pidBResult.rows[0].pid

          const dbA: Queryer = {
            query: (text, values) => clientA.query(text, values),
          }
          const dbB: Queryer = {
            query: (text, values) => clientB.query(text, values),
          }

          const resultA = await acquireBackupLock(
            databaseId,
            serverId,
            dbA,
          )
          expect(resultA.response).toBeNull()

          const pendingB = acquireBackupLock(
            databaseId,
            serverId,
            dbB,
          )

          await waitUntilBlocked(pidB)

          await clientA.query("COMMIT")

          const resultB = await pendingB

          expect(resultB.backupId).toBeNull()
          expect(resultB.response?.status).toBe(409)

          await clientB.query("ROLLBACK")
        } finally {
          clientA.release()
          clientB.release()
        }
      } finally {
        await testPool.query(`DELETE FROM databases WHERE id = $1`, [
          databaseId,
        ])
        await testPool.query(`DELETE FROM servers WHERE id = $1`, [
          serverId,
        ])
        await testPool.query(`DELETE FROM users WHERE id = $1`, [
          userId,
        ])
      }
    },
    10_000,
  )
})

/*
 * Décision produit validée : 10 sauvegardes COMPLÉTÉES maximum par
 * base, refus explicite (409) au-delà, jamais de suppression
 * automatique. Un backup 'creating' ne compte jamais pour ce quota.
 */
describe("acquireBackupLock — quota de sauvegardes (finding M2)", () => {
  it(`refuse la création au-delà de ${MAX_COMPLETED_BACKUPS_PER_DATABASE} sauvegardes complétées`, async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      for (
        let i = 0;
        i < MAX_COMPLETED_BACKUPS_PER_DATABASE;
        i += 1
      ) {
        await insertCompletedBackup(db, database.id, server.id)
      }

      const result = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(result.backupId).toBeNull()
      expect(result.response?.status).toBe(409)

      const body = await result.response!.json()
      expect(body.message).toContain(
        String(MAX_COMPLETED_BACKUPS_PER_DATABASE),
      )

      // Aucune ligne 'creating' n'a été insérée par la tentative refusée.
      const creatingCount = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM backups WHERE database_id = $1 AND status = 'creating'`,
        [database.id],
      )
      expect(creatingCount.rows[0].count).toBe("0")
    })
  })

  it(`autorise la création avec ${MAX_COMPLETED_BACKUPS_PER_DATABASE - 1} sauvegardes complétées (juste sous le quota)`, async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      for (
        let i = 0;
        i < MAX_COMPLETED_BACKUPS_PER_DATABASE - 1;
        i += 1
      ) {
        await insertCompletedBackup(db, database.id, server.id)
      }

      const result = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(result.response).toBeNull()
      expect(result.backupId).not.toBeNull()
    })
  })

  it("un backup 'creating' ne compte jamais dans le quota (seuls les 'completed' sont comptés)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      // MAX - 1 complétées + 1 'creating' (encapsulé dans son propre
      // cycle pour ne pas violer le verrou "un seul creating à la fois").
      for (
        let i = 0;
        i < MAX_COMPLETED_BACKUPS_PER_DATABASE - 1;
        i += 1
      ) {
        await insertCompletedBackup(db, database.id, server.id)
      }

      const creating = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )
      expect(creating.response).toBeNull()

      await markBackupFailed(
        creating.backupId!,
        "Nettoyage entre étapes du test.",
        db,
      )

      // À ce stade : MAX-1 'completed' + 1 'failed' (ne compte pas).
      const result = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      expect(result.response).toBeNull()
    })
  })

  it("le quota d'une base n'affecte jamais une autre base du même tenant", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const fullDatabase = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })
      const otherDatabase = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      for (
        let i = 0;
        i < MAX_COMPLETED_BACKUPS_PER_DATABASE;
        i += 1
      ) {
        await insertCompletedBackup(db, fullDatabase.id, server.id)
      }

      const refused = await acquireBackupLock(
        fullDatabase.id,
        server.id,
        db,
      )
      expect(refused.response?.status).toBe(409)

      const allowed = await acquireBackupLock(
        otherDatabase.id,
        server.id,
        db,
      )
      expect(allowed.response).toBeNull()
    })
  })

  it("le verrou/quota d'une base d'un tenant n'affecte jamais la base d'un autre tenant", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const otherOwner = await createTestUser(db)
      const server = await createTestServer(db)
      const fullDatabase = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })
      const otherTenantDatabase = await createTestDatabase(db, {
        userId: otherOwner.id,
        serverId: server.id,
      })

      for (
        let i = 0;
        i < MAX_COMPLETED_BACKUPS_PER_DATABASE;
        i += 1
      ) {
        await insertCompletedBackup(db, fullDatabase.id, server.id)
      }

      const refused = await acquireBackupLock(
        fullDatabase.id,
        server.id,
        db,
      )
      expect(refused.response?.status).toBe(409)

      const allowed = await acquireBackupLock(
        otherTenantDatabase.id,
        server.id,
        db,
      )
      expect(allowed.response).toBeNull()
    })
  })
})

describe("reclaimStaleBackups (isolé)", () => {
  it("réclame un backup 'creating' démarré avant le seuil de sécurité", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const staleCreatedAt = new Date(
        Date.now() - STALE_BACKUP_LOCK_MS - 60_000,
      )

      const staleResult = await db.query<{ id: string }>(
        `
          INSERT INTO backups (database_id, server_id, filename, status, created_at)
          VALUES ($1, $2, '', 'creating', $3)
          RETURNING id
        `,
        [database.id, server.id, staleCreatedAt],
      )
      const staleBackupId = staleResult.rows[0].id

      await reclaimStaleBackups(database.id, db)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM backups WHERE id = $1`,
        [staleBackupId],
      )
      expect(row.rows[0].status).toBe("failed")
    })
  })

  it("ne touche pas un backup 'creating' encore dans le délai de sécurité", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const recentResult = await db.query<{ id: string }>(
        `
          INSERT INTO backups (database_id, server_id, filename, status)
          VALUES ($1, $2, '', 'creating')
          RETURNING id
        `,
        [database.id, server.id],
      )
      const recentBackupId = recentResult.rows[0].id

      await reclaimStaleBackups(database.id, db)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM backups WHERE id = $1`,
        [recentBackupId],
      )
      expect(row.rows[0].status).toBe("creating")
    })
  })

  it("ne touche jamais un backup déjà terminal, même ancien", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const staleCreatedAt = new Date(
        Date.now() - STALE_BACKUP_LOCK_MS - 60_000,
      )

      const completedResult = await db.query<{ id: string }>(
        `
          INSERT INTO backups (database_id, server_id, filename, status, created_at)
          VALUES ($1, $2, 'x.sql.gz', 'completed', $3)
          RETURNING id
        `,
        [database.id, server.id, staleCreatedAt],
      )
      const completedBackupId = completedResult.rows[0].id

      await reclaimStaleBackups(database.id, db)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM backups WHERE id = $1`,
        [completedBackupId],
      )
      expect(row.rows[0].status).toBe("completed")
    })
  })

  it("réclame une base sans affecter le verrou 'creating' d'une AUTRE base (correctement scopé)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const staleDatabase = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })
      const otherDatabase = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const staleCreatedAt = new Date(
        Date.now() - STALE_BACKUP_LOCK_MS - 60_000,
      )

      await db.query(
        `
          INSERT INTO backups (database_id, server_id, filename, status, created_at)
          VALUES ($1, $2, '', 'creating', $3)
        `,
        [staleDatabase.id, server.id, staleCreatedAt],
      )

      const otherStaleResult = await db.query<{ id: string }>(
        `
          INSERT INTO backups (database_id, server_id, filename, status, created_at)
          VALUES ($1, $2, '', 'creating', $3)
          RETURNING id
        `,
        [otherDatabase.id, server.id, staleCreatedAt],
      )
      const otherStaleBackupId = otherStaleResult.rows[0].id

      // Ne réclame QUE staleDatabase — otherDatabase, tout aussi
      // orpheline, ne doit pas être affectée par cet appel précis.
      await reclaimStaleBackups(staleDatabase.id, db)

      const otherRow = await db.query<{ status: string }>(
        `SELECT status FROM backups WHERE id = $1`,
        [otherStaleBackupId],
      )
      expect(otherRow.rows[0].status).toBe("creating")
    })
  })
})

/*
 * Finding M2, même leçon que H1 ("statut final écrasable") appliquée
 * dès la conception : reproduit la race exacte — une requête dont
 * l'appel Agent traîne au-delà du délai de sécurité, pendant qu'une
 * AUTRE requête réclame le verrou comme abandonné.
 */
describe("CAS sur les transitions terminales — race réclamation vs réponse finale (finding M2)", () => {
  it("markBackupSuccess refuse d'écraser un backup déjà réclamé comme 'failed'", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const lock = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      await markBackupFailed(
        lock.backupId!,
        "[Auto] Réclamé par une autre requête pendant le test.",
        db,
      )

      const result = await markBackupSuccess(
        lock.backupId!,
        { filename: "trop-tard.sql.gz", sizeBytes: 999 },
        db,
      )

      expect(result.applied).toBe(false)

      const row = await db.query<{
        status: string
        filename: string
      }>(
        `SELECT status, filename FROM backups WHERE id = $1`,
        [lock.backupId],
      )

      expect(row.rows[0].status).toBe("failed")
      expect(row.rows[0].filename).not.toBe("trop-tard.sql.gz")
    })
  })

  it("markBackupFailed refuse d'écraser un backup déjà marqué 'completed'", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const lock = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      const successResult = await markBackupSuccess(
        lock.backupId!,
        { filename: "ok.sql.gz", sizeBytes: 100 },
        db,
      )
      expect(successResult.applied).toBe(true)

      const terminalResult = await markBackupFailed(
        lock.backupId!,
        "Arrivée en retard après le succès.",
        db,
      )

      expect(terminalResult.applied).toBe(false)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM backups WHERE id = $1`,
        [lock.backupId],
      )
      expect(row.rows[0].status).toBe("completed")
    })
  })

  it("markBackupSuccess réussit normalement quand la ligne est encore 'creating' (chemin nominal, non-régression)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const lock = await acquireBackupLock(
        database.id,
        server.id,
        db,
      )

      const result = await markBackupSuccess(
        lock.backupId!,
        { filename: "ok.sql.gz", sizeBytes: 4242 },
        db,
      )

      expect(result.applied).toBe(true)

      const row = await db.query<{
        status: string
        size_bytes: string
      }>(
        `SELECT status, size_bytes FROM backups WHERE id = $1`,
        [lock.backupId],
      )

      expect(row.rows[0].status).toBe("completed")
      expect(row.rows[0].size_bytes).toBe("4242")
    })
  })
})
