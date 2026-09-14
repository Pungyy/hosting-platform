import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import type { Queryer } from "@/lib/database"
import {
  acquireDeploymentLock,
  markDeploymentTerminal,
  STALE_DEPLOYMENT_LOCK_MS,
} from "@/lib/resources/deployments"
import {
  createTestServer,
  createTestSite,
  createTestUser,
} from "@/test/fixtures"
import { testPool } from "@/test/testDatabase"
import { withTestTransaction } from "@/test/withTestTransaction"

describe("acquireDeploymentLock", () => {
  it("aucun deployment running -> création autorisée", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await acquireDeploymentLock(site.id, "main", db)

      expect(result.response).toBeNull()
      expect(result.deploymentId).not.toBeNull()
    })
  })

  it("deployment déjà running pour ce site -> 409, aucun deuxième deployment créé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireDeploymentLock(site.id, "main", db)
      expect(first.response).toBeNull()

      /*
       * withTestTransaction partage UNE seule transaction pour tout le
       * test (nécessaire pour le rollback final) — contrairement à la
       * production, où query() auto-commit chaque instruction
       * séparément (pool.query() par appel, jamais de BEGIN explicite),
       * donc une violation de contrainte n'y affecte jamais les appels
       * suivants. Ici, un SAVEPOINT isole l'INSERT en échec attendu
       * pour ne pas invalider le reste de la transaction du test.
       */
      await db.query("SAVEPOINT before_conflict")

      const second = await acquireDeploymentLock(site.id, "main", db)

      expect(second.deploymentId).toBeNull()
      expect(second.response?.status).toBe(409)

      const body = await second.response!.json()
      expect(body.message).toBe(
        "Un déploiement est déjà en cours pour ce site.",
      )

      await db.query("ROLLBACK TO SAVEPOINT before_conflict")

      const countResult = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM deployments WHERE site_id = $1`,
        [site.id],
      )
      expect(countResult.rows[0].count).toBe("1")
    })
  })

  it("deployment success -> le verrou est libéré, un nouveau déploiement est autorisé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireDeploymentLock(site.id, "main", db)
      expect(first.response).toBeNull()

      await db.query(
        `UPDATE deployments SET status = 'success', finished_at = NOW() WHERE id = $1`,
        [first.deploymentId],
      )

      const second = await acquireDeploymentLock(site.id, "main", db)
      expect(second.response).toBeNull()
      expect(second.deploymentId).not.toBe(first.deploymentId)
    })
  })

  it("deployment failed -> le verrou est libéré, un nouveau déploiement est autorisé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireDeploymentLock(site.id, "main", db)
      expect(first.response).toBeNull()

      await markDeploymentTerminal(
        first.deploymentId!,
        "failed",
        "\n\nErreur de test.",
        db,
      )

      const second = await acquireDeploymentLock(site.id, "main", db)
      expect(second.response).toBeNull()
    })
  })

  it("deployment cancelled (timeout) -> le verrou est libéré, un nouveau déploiement est autorisé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireDeploymentLock(site.id, "main", db)
      expect(first.response).toBeNull()

      await markDeploymentTerminal(
        first.deploymentId!,
        "cancelled",
        "\n\nAnnulé pour test.",
        db,
      )

      const second = await acquireDeploymentLock(site.id, "main", db)
      expect(second.response).toBeNull()

      const rows = await db.query<{ status: string }>(
        `SELECT status FROM deployments WHERE id = $1`,
        [first.deploymentId],
      )
      expect(rows.rows[0].status).toBe("cancelled")
    })
  })

  it("un verrou 'running' très ancien (crash/restart) est réclamé automatiquement, pas bloqué indéfiniment", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const staleStartedAt = new Date(
        Date.now() - STALE_DEPLOYMENT_LOCK_MS - 60_000,
      )

      const staleResult = await db.query<{ id: string }>(
        `
          INSERT INTO deployments (site_id, branch, status, started_at)
          VALUES ($1, 'main', 'running', $2)
          RETURNING id
        `,
        [site.id, staleStartedAt],
      )
      const staleDeploymentId = staleResult.rows[0].id

      const result = await acquireDeploymentLock(site.id, "main", db)

      expect(result.response).toBeNull()
      expect(result.deploymentId).not.toBe(staleDeploymentId)

      const staleRow = await db.query<{ status: string }>(
        `SELECT status FROM deployments WHERE id = $1`,
        [staleDeploymentId],
      )
      expect(staleRow.rows[0].status).toBe("failed")
    })
  })

  it("un verrou 'running' récent (encore légitime) n'est PAS réclamé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const first = await acquireDeploymentLock(site.id, "main", db)
      expect(first.response).toBeNull()

      // Un deployment démarré il y a seulement quelques secondes ne
      // doit jamais être considéré comme abandonné.
      const second = await acquireDeploymentLock(site.id, "main", db)

      expect(second.deploymentId).toBeNull()
      expect(second.response?.status).toBe(409)
    })
  })

  it(
    "deux acquisitions réellement concurrentes (deux connexions Postgres distinctes) sur le même site -> une seule obtient le verrou",
    async () => {
      /*
       * Fixture délibérément commitée (pas de rollback) : elle doit
       * être visible depuis deux transactions Postgres indépendantes
       * démarrées sur deux connexions séparées, ce que withTestTransaction
       * (une seule connexion/transaction) ne permet pas de reproduire.
       * Nettoyage manuel dans le finally.
       */
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

      const siteName = `race-site-${suffix}`
      const siteResult = await testPool.query<{ id: string }>(
        `
          INSERT INTO sites (user_id, server_id, name, container_name, image, status)
          VALUES ($1, $2, $3, $4, 'nginx:alpine', 'online')
          RETURNING id
        `,
        [userId, serverId, siteName, `hosting-site-${siteName}`],
      )
      const siteId = siteResult.rows[0].id

      try {
        const clientA = await testPool.connect()
        const clientB = await testPool.connect()

        try {
          await clientA.query("BEGIN")
          await clientB.query("BEGIN")

          const dbA: Queryer = {
            query: (text, values) => clientA.query(text, values),
          }
          const dbB: Queryer = {
            query: (text, values) => clientB.query(text, values),
          }

          const resultA = await acquireDeploymentLock(siteId, "main", dbA)
          expect(resultA.response).toBeNull()

          /*
           * B tente en parallèle, SANS attendre : son INSERT se bloque
           * côté serveur Postgres tant que A n'a pas commit (verrou de
           * ligne posé par l'index unique partiel).
           */
          const pendingB = acquireDeploymentLock(siteId, "main", dbB)

          await new Promise((resolve) => setTimeout(resolve, 150))

          await clientA.query("COMMIT")

          const resultB = await pendingB

          expect(resultB.deploymentId).toBeNull()
          expect(resultB.response?.status).toBe(409)

          await clientB.query("ROLLBACK")
        } finally {
          clientA.release()
          clientB.release()
        }
      } finally {
        await testPool.query(`DELETE FROM sites WHERE id = $1`, [siteId])
        await testPool.query(`DELETE FROM servers WHERE id = $1`, [
          serverId,
        ])
        await testPool.query(`DELETE FROM users WHERE id = $1`, [userId])
      }
    },
    10_000,
  )
})

describe("markDeploymentTerminal", () => {
  it("écrit le status, finished_at et ajoute le message aux logs existants", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const { deploymentId } = await acquireDeploymentLock(
        site.id,
        "main",
        db,
      )

      await db.query(
        `UPDATE deployments SET logs = 'logs existants' WHERE id = $1`,
        [deploymentId],
      )

      await markDeploymentTerminal(
        deploymentId!,
        "cancelled",
        "\n\nSuffixe ajouté.",
        db,
      )

      const row = await db.query<{
        status: string
        finished_at: string | null
        logs: string | null
      }>(
        `SELECT status, finished_at, logs FROM deployments WHERE id = $1`,
        [deploymentId],
      )

      expect(row.rows[0].status).toBe("cancelled")
      expect(row.rows[0].finished_at).not.toBeNull()
      expect(row.rows[0].logs).toBe(
        "logs existants\n\nSuffixe ajouté.",
      )
    })
  })
})
