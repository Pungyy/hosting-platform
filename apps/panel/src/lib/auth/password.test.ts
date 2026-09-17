import argon2 from "argon2"
import { describe, expect, it } from "vitest"

import { createUser } from "@/lib/auth/password"
import { withTestTransaction } from "@/test/withTestTransaction"

/*
 * Tests d'intégration réels (vraie base de test, vrai argon2) — pas de
 * mock sur le hash : le point exact à prouver ("jamais stocké en clair")
 * n'a de sens que vérifié contre un vrai hash, pas un stub.
 */
describe("createUser (inscription)", () => {
  it("crée un utilisateur avec un mot de passe RÉELLEMENT hashé, jamais stocké en clair", async () => {
    await withTestTransaction(async (db) => {
      const email = `register-${Date.now()}@fixtures.internal`

      const result = await createUser(
        { email, password: "un-mot-de-passe-valide", name: "register" },
        db,
      )

      expect(result.status).toBe("ok")
      if (result.status !== "ok") return

      expect(result.user.email).toBe(email)
      expect(result.user.role).toBe("user")

      const row = await db.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1",
        [result.user.id],
      )

      const storedHash = row.rows[0].password_hash

      // Jamais en clair, jamais un hash reconnaissable comme réversible.
      expect(storedHash).not.toBe("un-mot-de-passe-valide")
      expect(storedHash.startsWith("$argon2")).toBe(true)

      // Mais un hash argon2 RÉEL et VALIDE du mot de passe fourni.
      expect(await argon2.verify(storedHash, "un-mot-de-passe-valide")).toBe(
        true,
      )

      // Jamais valide pour un autre mot de passe.
      expect(await argon2.verify(storedHash, "un-autre-mot-de-passe")).toBe(
        false,
      )
    })
  })

  it("email déjà existant -> status 'email_taken', aucune ligne dupliquée (contrainte UNIQUE, pas de check-then-act)", async () => {
    await withTestTransaction(async (db) => {
      const email = `register-dup-${Date.now()}@fixtures.internal`

      const first = await createUser(
        { email, password: "premier-mot-de-passe", name: "premier" },
        db,
      )
      expect(first.status).toBe("ok")

      /*
       * withTestTransaction partage une seule transaction pour tout le
       * test — un SAVEPOINT isole la violation de contrainte attendue,
       * comme dans deployments.test.ts/backups.test.ts.
       */
      await db.query("SAVEPOINT before_conflict")

      const second = await createUser(
        { email, password: "un-autre-mot-de-passe", name: "second" },
        db,
      )
      expect(second.status).toBe("email_taken")

      await db.query("ROLLBACK TO SAVEPOINT before_conflict")

      const count = await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users WHERE email = $1",
        [email],
      )
      expect(count.rows[0].count).toBe("1")
    })
  })

  it("normalise l'email en minuscules avant insertion (cohérent avec la recherche insensible à la casse du login)", async () => {
    await withTestTransaction(async (db) => {
      const email = `Register-Case-${Date.now()}@Fixtures.Internal`

      const result = await createUser(
        { email, password: "un-mot-de-passe-valide", name: "case" },
        db,
      )

      expect(result.status).toBe("ok")
      if (result.status !== "ok") return
      expect(result.user.email).toBe(email.trim().toLowerCase())
    })
  })
})
