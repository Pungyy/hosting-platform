import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { AGENT_DEPLOYMENT_TIMEOUT_MS } from "@/lib/agent/client"
import type { Queryer } from "@/lib/database"
import {
  acquireDeploymentLock,
  acquireTenantDeploymentSlot,
  markDeploymentSuccess,
  markDeploymentTerminal,
  MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT,
  RECLAIM_SAFETY_MARGIN_MS,
  reclaimStaleDeployments,
  releaseTenantDeploymentSlot,
  STALE_DEPLOYMENT_LOCK_MS,
} from "@/lib/resources/deployments"
import {
  createTestServer,
  createTestSite,
  createTestUser,
} from "@/test/fixtures"
import { testPool } from "@/test/testDatabase"
import { withTestTransaction } from "@/test/withTestTransaction"

/*
 * Attend, de façon déterministe, qu'un backend Postgres soit RÉELLEMENT
 * bloqué par un autre (pg_blocking_pids) — remplace un délai arbitraire
 * (revue indépendante du commit H1 2054172, finding "tests" §5) qui
 * pourrait être trop court sur une machine chargée (test flaky, faux
 * négatif) ou inutilement long sinon.
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

async function tenantSlotCount(
  db: Queryer,
  userId: string,
): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT count FROM tenant_deployment_slots WHERE user_id = $1`,
    [userId],
  )
  return result.rows[0]?.count ?? 0
}

/*
 * Invariant timeout Agent / stale-lock Panel (finding H1, "invariant
 * 8 min / 15 min" — revue indépendante du commit 2054172, §3) :
 * STALE_DEPLOYMENT_LOCK_MS doit rester strictement supérieur au
 * budget total que le Panel autorise lui-même à l'Agent. Ce test ne
 * vérifie pas un comportement dynamique : il vérifie que la RELATION
 * ARITHMÉTIQUE entre les deux constantes (dérivation, pas deux
 * nombres indépendants) reste intacte si quelqu'un modifie l'un des
 * deux fichiers plus tard sans y penser.
 */
describe("Invariant timeout Agent / stale-lock Panel (finding H1)", () => {
  it("STALE_DEPLOYMENT_LOCK_MS reste strictement supérieur au budget total Agent", () => {
    expect(STALE_DEPLOYMENT_LOCK_MS).toBeGreaterThan(
      AGENT_DEPLOYMENT_TIMEOUT_MS,
    )
  })

  it("la marge de sécurité est exactement RECLAIM_SAFETY_MARGIN_MS (dérivation, pas un second nombre indépendant)", () => {
    expect(
      STALE_DEPLOYMENT_LOCK_MS - AGENT_DEPLOYMENT_TIMEOUT_MS,
    ).toBe(RECLAIM_SAFETY_MARGIN_MS)
  })
})

describe("acquireDeploymentLock", () => {
  it("aucun deployment running -> création autorisée", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

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

      const first = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
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

      const second = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

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

      const first = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
      expect(first.response).toBeNull()

      await db.query(
        `UPDATE deployments SET status = 'success', finished_at = NOW() WHERE id = $1`,
        [first.deploymentId],
      )

      const second = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
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

      const first = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
      expect(first.response).toBeNull()

      await markDeploymentTerminal(
        first.deploymentId!,
        "failed",
        "\n\nErreur de test.",
        db,
      )

      const second = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
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

      const first = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
      expect(first.response).toBeNull()

      await markDeploymentTerminal(
        first.deploymentId!,
        "cancelled",
        "\n\nAnnulé pour test.",
        db,
      )

      const second = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
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

      const result = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

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

      const first = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )
      expect(first.response).toBeNull()

      // Un deployment démarré il y a seulement quelques secondes ne
      // doit jamais être considéré comme abandonné.
      const second = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

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

          const resultA = await acquireDeploymentLock(
            siteId,
            userId,
            "main",
            dbA,
          )
          expect(resultA.response).toBeNull()

          /*
           * B tente en parallèle, SANS attendre : son INSERT se bloque
           * côté serveur Postgres tant que A n'a pas commit (verrou de
           * ligne posé par l'index unique partiel).
           */
          const pendingB = acquireDeploymentLock(
            siteId,
            userId,
            "main",
            dbB,
          )

          /*
           * Attend une preuve RÉELLE (pg_blocking_pids) que B est bien
           * bloqué par A avant de commit — pas un délai arbitraire
           * (finding H1, "tests", revue indépendante du commit
           * 2054172, §5) qui pourrait laisser passer une exécution où
           * B aurait en réalité déjà fini (faux négatif masquant une
           * régression de l'exclusion mutuelle) ou ralentir le test
           * sans raison sur une machine rapide.
           */
          await waitUntilBlocked(pidB)

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
        owner.id,
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

/*
 * Testée directement plutôt que seulement de façon incidente via
 * acquireDeploymentLock() (qui l'appelle en interne) — la revue
 * indépendante du commit H1 2054172 notait que le mécanisme de
 * réclamation n'était pas isolé dans son propre test (finding
 * "tests", §5).
 */
describe("reclaimStaleDeployments (isolé)", () => {
  it("réclame un deployment 'running' démarré avant le seuil de sécurité", async () => {
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

      await reclaimStaleDeployments(site.id, owner.id, db)

      const row = await db.query<{
        status: string
        finished_at: string | null
      }>(
        `SELECT status, finished_at FROM deployments WHERE id = $1`,
        [staleDeploymentId],
      )

      expect(row.rows[0].status).toBe("failed")
      expect(row.rows[0].finished_at).not.toBeNull()
    })
  })

  it("ne touche pas un deployment 'running' encore dans le délai de sécurité", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const recentResult = await db.query<{ id: string }>(
        `
          INSERT INTO deployments (site_id, branch, status, started_at)
          VALUES ($1, 'main', 'running', NOW())
          RETURNING id
        `,
        [site.id],
      )
      const recentDeploymentId = recentResult.rows[0].id

      await reclaimStaleDeployments(site.id, owner.id, db)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM deployments WHERE id = $1`,
        [recentDeploymentId],
      )

      expect(row.rows[0].status).toBe("running")
    })
  })

  it("ne touche jamais un deployment déjà terminal, même ancien", async () => {
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

      const successResult = await db.query<{ id: string }>(
        `
          INSERT INTO deployments (site_id, branch, status, started_at, finished_at)
          VALUES ($1, 'main', 'success', $2, NOW())
          RETURNING id
        `,
        [site.id, staleStartedAt],
      )
      const successDeploymentId = successResult.rows[0].id

      await reclaimStaleDeployments(site.id, owner.id, db)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM deployments WHERE id = $1`,
        [successDeploymentId],
      )

      expect(row.rows[0].status).toBe("success")
    })
  })
})

/*
 * Finding H1, "statut final écrasable" (revue indépendante du commit
 * 2054172, §1) : reproduit la race exacte signalée — une requête dont
 * l'appel Agent traîne au-delà du délai de sécurité, pendant qu'une
 * AUTRE requête (typiquement la prochaine acquireDeploymentLock() sur
 * le même site) réclame le verrou comme abandonné. Sans le CAS
 * (WHERE status = 'running'), la première requête écraserait
 * silencieusement le statut 'failed' déjà tranché.
 */
describe("CAS sur les transitions terminales — race réclamation vs réponse finale (finding H1)", () => {
  it("markDeploymentSuccess refuse d'écraser un deployment déjà réclamé comme 'failed'", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const { deploymentId } = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

      /*
       * Simule la réclamation paresseuse (reclaimStaleDeployments)
       * qui aurait eu lieu PENDANT que l'appel Agent de cette requête
       * était encore en cours — indépendamment du mécanisme de
       * réclamation lui-même (déjà testé isolément ci-dessus), pour
       * isoler strictement le comportement du CAS.
       */
      await markDeploymentTerminal(
        deploymentId!,
        "failed",
        "\n\n[Auto] Réclamé par une autre requête pendant le test.",
        db,
      )

      const result = await markDeploymentSuccess(
        deploymentId!,
        {
          commitSha: "a".repeat(40),
          logs: "build réussi, mais trop tard",
          imageName: "hosting/demo:x",
          imageId: "sha256:x",
          containerName: "hosting-site-demo",
          containerId: "container-x",
        },
        db,
      )

      expect(result.applied).toBe(false)

      const row = await db.query<{
        status: string
        image_name: string | null
      }>(
        `SELECT status, image_name FROM deployments WHERE id = $1`,
        [deploymentId],
      )

      // Le statut 'failed' déjà tranché n'a jamais été écrasé par
      // 'success', et aucun champ associé au succès n'a été écrit.
      expect(row.rows[0].status).toBe("failed")
      expect(row.rows[0].image_name).toBeNull()
    })
  })

  it("markDeploymentTerminal refuse d'écraser un deployment déjà marqué 'success'", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const { deploymentId } = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

      const successResult = await markDeploymentSuccess(
        deploymentId!,
        {
          commitSha: "a".repeat(40),
          logs: "build réussi",
          imageName: "hosting/demo:x",
          imageId: "sha256:x",
          containerName: "hosting-site-demo",
          containerId: "container-x",
        },
        db,
      )
      expect(successResult.applied).toBe(true)

      const terminalResult = await markDeploymentTerminal(
        deploymentId!,
        "failed",
        "\n\nArrivée en retard après le succès.",
        db,
      )

      expect(terminalResult.applied).toBe(false)

      const row = await db.query<{ status: string }>(
        `SELECT status FROM deployments WHERE id = $1`,
        [deploymentId],
      )

      expect(row.rows[0].status).toBe("success")
    })
  })

  it("markDeploymentSuccess réussit normalement quand la ligne est encore 'running' (chemin nominal, non-régression)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const { deploymentId } = await acquireDeploymentLock(
        site.id,
        owner.id,
        "main",
        db,
      )

      const result = await markDeploymentSuccess(
        deploymentId!,
        {
          commitSha: "a".repeat(40),
          logs: "build réussi",
          imageName: "hosting/demo:x",
          imageId: "sha256:x",
          containerName: "hosting-site-demo",
          containerId: "container-x",
        },
        db,
      )

      expect(result.applied).toBe(true)

      const row = await db.query<{
        status: string
        image_name: string | null
      }>(
        `SELECT status, image_name FROM deployments WHERE id = $1`,
        [deploymentId],
      )

      expect(row.rows[0].status).toBe("success")
      expect(row.rows[0].image_name).toBe("hosting/demo:x")
    })
  })
})

/*
 * Finding M3-2 (audit sécurité) — plafond de deployments 'running'
 * simultanés par tenant, en plus du verrou H1 (1 par site). Compteur
 * séparé de user_resource_quotas (M3-1) : reflète EXCLUSIVEMENT les
 * deployments actuellement 'running', jamais un total historique.
 */
describe(`acquireTenantDeploymentSlot / releaseTenantDeploymentSlot (limite = ${MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT}, finding M3-2)`, () => {
  it("tenant à 0 deployment running -> le 1er est autorisé", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      const result = await acquireTenantDeploymentSlot(owner.id, db)

      expect(result.acquired).toBe(true)
      expect(await tenantSlotCount(db, owner.id)).toBe(1)
    })
  })

  it("tenant à 1 deployment running -> le 2e est autorisé (atteint la limite)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      const first = await acquireTenantDeploymentSlot(owner.id, db)
      expect(first.acquired).toBe(true)

      const second = await acquireTenantDeploymentSlot(owner.id, db)
      expect(second.acquired).toBe(true)

      expect(await tenantSlotCount(db, owner.id)).toBe(
        MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT,
      )
    })
  })

  it(`tenant à ${MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT} deployments running -> le suivant est refusé (409)`, async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      for (let i = 0; i < MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT; i += 1) {
        const result = await acquireTenantDeploymentSlot(owner.id, db)
        expect(result.acquired).toBe(true)
      }

      const refused = await acquireTenantDeploymentSlot(owner.id, db)

      expect(refused.acquired).toBe(false)
      expect(refused.response?.status).toBe(409)
      expect(await tenantSlotCount(db, owner.id)).toBe(
        MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT,
      )
    })
  })

  it("releaseTenantDeploymentSlot libère un slot, permettant une nouvelle acquisition ensuite", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      for (let i = 0; i < MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT; i += 1) {
        await acquireTenantDeploymentSlot(owner.id, db)
      }

      const refused = await acquireTenantDeploymentSlot(owner.id, db)
      expect(refused.acquired).toBe(false)

      await releaseTenantDeploymentSlot(owner.id, db)

      const afterRelease = await acquireTenantDeploymentSlot(owner.id, db)
      expect(afterRelease.acquired).toBe(true)
      expect(await tenantSlotCount(db, owner.id)).toBe(
        MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT,
      )
    })
  })

  it("deux tenants indépendants : chacun obtient ses propres slots, sans se bloquer mutuellement", async () => {
    await withTestTransaction(async (db) => {
      const tenantA = await createTestUser(db)
      const tenantB = await createTestUser(db)

      for (let i = 0; i < MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT; i += 1) {
        const resultA = await acquireTenantDeploymentSlot(tenantA.id, db)
        expect(resultA.acquired).toBe(true)
      }

      const refusedA = await acquireTenantDeploymentSlot(tenantA.id, db)
      expect(refusedA.acquired).toBe(false)

      const resultB = await acquireTenantDeploymentSlot(tenantB.id, db)
      expect(resultB.acquired).toBe(true)
      expect(await tenantSlotCount(db, tenantB.id)).toBe(1)
    })
  })

  it(
    "deux acquisitions réellement concurrentes (deux connexions Postgres distinctes) avec 1 slot restant -> une seule réussit, jamais plus de la limite",
    async () => {
      const email = `deploy-slot-race-${randomUUID()}@fixtures.internal`
      const userResult = await testPool.query<{ id: string }>(
        `INSERT INTO users (email, name, role) VALUES ($1, $2, 'user') RETURNING id`,
        [email, "Slot Race Fixture"],
      )
      const userId = userResult.rows[0].id

      try {
        /*
         * Pré-remplit le compteur à (limite - 1), en dehors de toute
         * transaction ouverte — pour que les deux connexions A/B
         * ci-dessous se disputent réellement le DERNIER slot restant.
         */
        await testPool.query(
          `
            INSERT INTO tenant_deployment_slots (user_id, count)
            VALUES ($1, $2)
          `,
          [userId, MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT - 1],
        )

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

          const resultA = await acquireTenantDeploymentSlot(userId, dbA)
          expect(resultA.acquired).toBe(true)

          const pendingB = acquireTenantDeploymentSlot(userId, dbB)

          await waitUntilBlocked(pidB)

          await clientA.query("COMMIT")

          const resultB = await pendingB

          expect(resultB.acquired).toBe(false)
          expect(resultB.response?.status).toBe(409)

          await clientB.query("ROLLBACK")
        } finally {
          clientA.release()
          clientB.release()
        }

        const finalCount = await testPool.query<{ count: number }>(
          `SELECT count FROM tenant_deployment_slots WHERE user_id = $1`,
          [userId],
        )
        expect(finalCount.rows[0].count).toBe(
          MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT,
        )
      } finally {
        await testPool.query(
          `DELETE FROM tenant_deployment_slots WHERE user_id = $1`,
          [userId],
        )
        await testPool.query(`DELETE FROM users WHERE id = $1`, [userId])
      }
    },
    10_000,
  )
})

/*
 * Finding M3-2 — reclaimStaleDeployments est la SEULE façon dont un
 * deployment peut quitter 'running' sans que le code de la requête qui
 * l'a créé ne s'exécute (celle-ci peut être bloquée indéfiniment sur
 * un appel Agent mort) : elle doit donc libérer elle-même le slot
 * tenant correspondant, sinon le compteur resterait indéfiniment
 * incohérent avec la réalité pour ce cas précis.
 */
describe("reclaimStaleDeployments libère le slot tenant (finding M3-2)", () => {
  it("réclame un deployment 'running' stale ET libère son slot tenant", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      // Simule un deployment qui, au moment de son acquisition, avait
      // réellement réservé un slot tenant.
      const slot = await acquireTenantDeploymentSlot(owner.id, db)
      expect(slot.acquired).toBe(true)

      const staleStartedAt = new Date(
        Date.now() - STALE_DEPLOYMENT_LOCK_MS - 60_000,
      )
      await db.query(
        `
          INSERT INTO deployments (site_id, branch, status, started_at)
          VALUES ($1, 'main', 'running', $2)
        `,
        [site.id, staleStartedAt],
      )

      expect(await tenantSlotCount(db, owner.id)).toBe(1)

      await reclaimStaleDeployments(site.id, owner.id, db)

      expect(await tenantSlotCount(db, owner.id)).toBe(0)
    })
  })

  it("ne touche PAS le compteur quand il n'y a rien à réclamer (deployment récent)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      await acquireTenantDeploymentSlot(owner.id, db)

      await db.query(
        `
          INSERT INTO deployments (site_id, branch, status, started_at)
          VALUES ($1, 'main', 'running', NOW())
        `,
        [site.id],
      )

      await reclaimStaleDeployments(site.id, owner.id, db)

      // Le deployment récent n'a pas été réclamé -> le slot doit
      // rester détenu, jamais libéré à tort.
      expect(await tenantSlotCount(db, owner.id)).toBe(1)
    })
  })

  it("ne touche jamais le compteur pour un deployment déjà terminal (même ancien)", async () => {
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
      await db.query(
        `
          INSERT INTO deployments (site_id, branch, status, started_at, finished_at)
          VALUES ($1, 'main', 'success', $2, NOW())
        `,
        [site.id, staleStartedAt],
      )

      // Aucun slot n'a été acquis pour ce deployment déjà terminal —
      // le compteur doit rester à 0, la réclamation ne doit jamais le
      // faire passer en négatif ni le "libérer" à tort.
      await reclaimStaleDeployments(site.id, owner.id, db)

      expect(await tenantSlotCount(db, owner.id)).toBe(0)
    })
  })
})
