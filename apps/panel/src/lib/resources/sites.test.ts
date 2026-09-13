import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { getOwnedSite } from "@/lib/resources/sites"
import {
  createTestServer,
  createTestSite,
  createTestUser,
  sessionOf,
} from "@/test/fixtures"
import { withTestTransaction } from "@/test/withTestTransaction"

describe("getOwnedSite", () => {
  it("renvoie le site pour son propriétaire", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedSite(site.id, sessionOf(owner), db)

      expect(result.response).toBeNull()
      expect(result.site?.id).toBe(site.id)
      expect(result.site?.user_id).toBe(owner.id)
    })
  })

  it("renvoie 404 pour un autre utilisateur authentifié", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const other = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedSite(site.id, sessionOf(other), db)

      expect(result.site).toBeNull()
      expect(result.response?.status).toBe(404)
    })
  })

  it("renvoie exactement le même corps pour 'appartient à un autre' et 'inexistant' (pas de 403 révélateur)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const other = await createTestUser(db)
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const forOther = await getOwnedSite(site.id, sessionOf(other), db)
      const forMissing = await getOwnedSite(randomUUID(), sessionOf(owner), db)

      expect(forOther.response).not.toBeNull()
      expect(forOther.response!.status).toBe(forMissing.response!.status)
      expect(await forOther.response!.json()).toEqual(
        await forMissing.response!.json(),
      )
    })
  })

  it("renvoie le site pour un admin quel que soit le propriétaire", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const admin = await createTestUser(db, "admin")
      const server = await createTestServer(db)
      const site = await createTestSite(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedSite(
        site.id,
        sessionOf(admin, "admin"),
        db,
      )

      expect(result.response).toBeNull()
      expect(result.site?.id).toBe(site.id)
    })
  })

  it("renvoie 404 pour un id inexistant", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      const result = await getOwnedSite(randomUUID(), sessionOf(owner), db)

      expect(result.site).toBeNull()
      expect(result.response?.status).toBe(404)
    })
  })

  it("rejette un id malformé (comportement DB existant préservé, pas géré par le chargeur)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      await expect(
        getOwnedSite("pas-un-uuid", sessionOf(owner), db),
      ).rejects.toThrow()
    })
  })
})
