import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import { getOwnedDatabase } from "@/lib/resources/databases"
import {
  createTestDatabase,
  createTestServer,
  createTestUser,
  sessionOf,
} from "@/test/fixtures"
import { withTestTransaction } from "@/test/withTestTransaction"

describe("getOwnedDatabase", () => {
  it("renvoie la base pour son propriétaire", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedDatabase(database.id, sessionOf(owner), db)

      expect(result.response).toBeNull()
      expect(result.database?.id).toBe(database.id)
    })
  })

  it("renvoie 404 pour un autre utilisateur authentifié", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const other = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedDatabase(database.id, sessionOf(other), db)

      expect(result.database).toBeNull()
      expect(result.response?.status).toBe(404)
    })
  })

  it("renvoie exactement le même corps pour 'appartient à un autre' et 'inexistant'", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const other = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const forOther = await getOwnedDatabase(
        database.id,
        sessionOf(other),
        db,
      )
      const forMissing = await getOwnedDatabase(
        randomUUID(),
        sessionOf(owner),
        db,
      )

      expect(forOther.response!.status).toBe(forMissing.response!.status)
      expect(await forOther.response!.json()).toEqual(
        await forMissing.response!.json(),
      )
    })
  })

  it("renvoie la base pour un admin quel que soit le propriétaire", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const admin = await createTestUser(db, "admin")
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedDatabase(
        database.id,
        sessionOf(admin, "admin"),
        db,
      )

      expect(result.response).toBeNull()
      expect(result.database?.id).toBe(database.id)
    })
  })

  it("renvoie 404 pour un id inexistant", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)

      const result = await getOwnedDatabase(randomUUID(), sessionOf(owner), db)

      expect(result.database).toBeNull()
      expect(result.response?.status).toBe(404)
    })
  })

  /*
   * Vérification spécifique demandée : le mot de passe chiffré doit être
   * présent sur l'objet renvoyé par le chargeur (nécessaire pour que
   * GET /api/databases/[id] puisse le déchiffrer pour son propriétaire),
   * mais c'est à CHAQUE ROUTE de décider quoi en faire — le chargeur ne
   * filtre pas ce champ lui-même. Ce test documente ce contrat pour éviter
   * qu'un futur changement l'enlève silencieusement (ce qui casserait la
   * fonctionnalité) ou l'expose ailleurs par erreur.
   */
  it("inclut password_encrypted dans la ligne retournée (contrat documenté, pas un accès direct au client)", async () => {
    await withTestTransaction(async (db) => {
      const owner = await createTestUser(db)
      const server = await createTestServer(db)
      const database = await createTestDatabase(db, {
        userId: owner.id,
        serverId: server.id,
      })

      const result = await getOwnedDatabase(database.id, sessionOf(owner), db)

      expect(result.database?.password_encrypted).toBe(
        "fixture-encrypted-value",
      )
    })
  })
})
