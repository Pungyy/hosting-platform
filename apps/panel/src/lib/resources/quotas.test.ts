import { describe, expect, it } from "vitest"

import type { Queryer } from "@/lib/database"
import {
  MAX_DATABASES_PER_USER,
  MAX_SITES_PER_USER,
  releaseResourceQuota,
  reserveResourceQuota,
  type QuotaResourceType,
} from "@/lib/resources/quotas"
import { createTestUser } from "@/test/fixtures"
import { testPool } from "@/test/testDatabase"
import { withTestTransaction } from "@/test/withTestTransaction"

const poolDb: Queryer = testPool

/*
 * Attend, de façon déterministe, qu'un backend Postgres soit RÉELLEMENT
 * bloqué par un autre (pg_blocking_pids) — même technique que les tests
 * de concurrence de deployments.test.ts (finding H1) et backups.test.ts
 * (finding M2) : jamais un délai arbitraire qui pourrait être trop court
 * (faux négatif) ou inutile.
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

/*
 * Exécute la même suite de vérifications pour "site" et "database" —
 * les deux partagent exactement le même mécanisme (table
 * user_resource_quotas), seule la limite/le type diffère.
 */
function describeQuotaResource(
  resourceType: QuotaResourceType,
  limit: number,
) {
  describe(`quota "${resourceType}" (limite = ${limit})`, () => {
    it(`autorise jusqu'à ${limit} réservations puis refuse la ${limit + 1}e (409)`, async () => {
      await withTestTransaction(async (db) => {
        const owner = await createTestUser(db)

        for (let i = 0; i < limit; i += 1) {
          const result = await reserveResourceQuota(
            owner.id,
            resourceType,
            limit,
            db,
          )
          expect(result.reserved).toBe(true)
        }

        const overLimit = await reserveResourceQuota(
          owner.id,
          resourceType,
          limit,
          db,
        )

        expect(overLimit.reserved).toBe(false)
        expect(overLimit.response?.status).toBe(409)
      })
    })

    it("releaseResourceQuota libère un slot, permettant une nouvelle réservation ensuite", async () => {
      await withTestTransaction(async (db) => {
        const owner = await createTestUser(db)

        for (let i = 0; i < limit; i += 1) {
          await reserveResourceQuota(owner.id, resourceType, limit, db)
        }

        const refused = await reserveResourceQuota(
          owner.id,
          resourceType,
          limit,
          db,
        )
        expect(refused.reserved).toBe(false)

        await releaseResourceQuota(owner.id, resourceType, db)

        const afterRelease = await reserveResourceQuota(
          owner.id,
          resourceType,
          limit,
          db,
        )
        expect(afterRelease.reserved).toBe(true)

        const refusedAgain = await reserveResourceQuota(
          owner.id,
          resourceType,
          limit,
          db,
        )
        expect(refusedAgain.reserved).toBe(false)
      })
    })

    it(
      "échec de création après réservation (release systématique) ne laisse " +
        "aucun compteur incohérent — réserver puis libérer N fois ne dérive jamais",
      async () => {
        await withTestTransaction(async (db) => {
          const owner = await createTestUser(db)

          for (let i = 0; i < limit * 2; i += 1) {
            const reserved = await reserveResourceQuota(
              owner.id,
              resourceType,
              limit,
              db,
            )
            expect(reserved.reserved).toBe(true)

            await releaseResourceQuota(owner.id, resourceType, db)
          }

          for (let i = 0; i < limit; i += 1) {
            const result = await reserveResourceQuota(
              owner.id,
              resourceType,
              limit,
              db,
            )
            expect(result.reserved).toBe(true)
          }

          const overLimit = await reserveResourceQuota(
            owner.id,
            resourceType,
            limit,
            db,
          )
          expect(overLimit.reserved).toBe(false)
        })
      },
    )

    it("un tenant à la limite n'empêche pas un AUTRE tenant de réserver", async () => {
      await withTestTransaction(async (db) => {
        const tenantAtLimit = await createTestUser(db)
        const otherTenant = await createTestUser(db)

        for (let i = 0; i < limit; i += 1) {
          await reserveResourceQuota(
            tenantAtLimit.id,
            resourceType,
            limit,
            db,
          )
        }

        const refused = await reserveResourceQuota(
          tenantAtLimit.id,
          resourceType,
          limit,
          db,
        )
        expect(refused.reserved).toBe(false)

        const otherResult = await reserveResourceQuota(
          otherTenant.id,
          resourceType,
          limit,
          db,
        )
        expect(otherResult.reserved).toBe(true)
      })
    })
  })
}

describeQuotaResource("site", MAX_SITES_PER_USER)
describeQuotaResource("database", MAX_DATABASES_PER_USER)

describe("quotas — isolation entre types de ressources pour le MÊME utilisateur", () => {
  it("épuiser le quota de sites ne bloque pas la création d'une base pour le même utilisateur", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      for (let i = 0; i < MAX_SITES_PER_USER; i += 1) {
        await reserveResourceQuota(owner.id, "site", MAX_SITES_PER_USER, db)
      }

      const siteRefused = await reserveResourceQuota(
        owner.id,
        "site",
        MAX_SITES_PER_USER,
        db,
      )
      expect(siteRefused.reserved).toBe(false)

      const databaseAllowed = await reserveResourceQuota(
        owner.id,
        "database",
        MAX_DATABASES_PER_USER,
        db,
      )
      expect(databaseAllowed.reserved).toBe(true)
    })
  })
})

describe("réservation réellement concurrente (deux connexions Postgres distinctes)", () => {
  it(
    "deux réservations concurrentes autour de la limite -> impossible d'obtenir plus que la limite",
    async () => {
      const owner = await createTestUser(poolDb)

      const limit = 3

      try {
        /*
         * Pré-remplit le compteur à (limite - 1), en dehors de toute
         * transaction ouverte — pour que les deux connexions A/B
         * ci-dessous se disputent réellement le DERNIER slot restant.
         */
        await testPool.query(
          `
            INSERT INTO user_resource_quotas (user_id, resource_type, count)
            VALUES ($1, 'site', $2)
          `,
          [owner.id, limit - 1],
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

          const resultA = await reserveResourceQuota(
            owner.id,
            "site",
            limit,
            dbA,
          )
          expect(resultA.reserved).toBe(true)

          const pendingB = reserveResourceQuota(
            owner.id,
            "site",
            limit,
            dbB,
          )

          await waitUntilBlocked(pidB)

          await clientA.query("COMMIT")

          const resultB = await pendingB

          expect(resultB.reserved).toBe(false)
          expect(resultB.response?.status).toBe(409)

          await clientB.query("ROLLBACK")
        } finally {
          clientA.release()
          clientB.release()
        }

        const finalCount = await testPool.query<{ count: number }>(
          `
            SELECT count
            FROM user_resource_quotas
            WHERE user_id = $1 AND resource_type = 'site'
          `,
          [owner.id],
        )

        expect(finalCount.rows[0].count).toBe(limit)
      } finally {
        await testPool.query(
          `DELETE FROM user_resource_quotas WHERE user_id = $1`,
          [owner.id],
        )
        await testPool.query(`DELETE FROM users WHERE id = $1`, [owner.id])
      }
    },
    10_000,
  )

  it("deux tenants indépendants réservant en même temps ne se bloquent jamais mutuellement", async () => {
    const ownerA = await createTestUser(poolDb)
    const ownerB = await createTestUser(poolDb)

    try {
      const [resultA, resultB] = await Promise.all([
        reserveResourceQuota(ownerA.id, "site", MAX_SITES_PER_USER, poolDb),
        reserveResourceQuota(ownerB.id, "site", MAX_SITES_PER_USER, poolDb),
      ])

      expect(resultA.reserved).toBe(true)
      expect(resultB.reserved).toBe(true)
    } finally {
      await testPool.query(
        `DELETE FROM user_resource_quotas WHERE user_id = ANY($1)`,
        [[ownerA.id, ownerB.id]],
      )
      await testPool.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [ownerA.id, ownerB.id],
      ])
    }
  })
})
