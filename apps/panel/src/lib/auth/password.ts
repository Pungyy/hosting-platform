import argon2 from "argon2"

import { query, type Queryer } from "@/lib/database"

const USERS_EMAIL_UNIQUE_CONSTRAINT = "users_email_key"

function isEmailUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const pgError = error as { code?: unknown; constraint?: unknown }

  return (
    pgError.code === "23505" &&
    pgError.constraint === USERS_EMAIL_UNIQUE_CONSTRAINT
  )
}

export type CreateUserResult =
  | {
      status: "ok"
      user: { id: string; email: string; name: string; role: "user" | "admin" }
    }
  | { status: "email_taken" }

/*
 * Crée un utilisateur avec un mot de passe hashé (jamais stocké en
 * clair). Unicité de l'email garantie par la contrainte UNIQUE déjà
 * posée sur `users.email` (migration 001) — pas de SELECT préalable
 * suivi d'un INSERT séparé (fenêtre de course entre deux inscriptions
 * concurrentes sur le même email) : on tente directement l'INSERT et on
 * traduit une violation de cette contrainte précise en résultat
 * "email_taken", même logique CAS que reserveResourceQuota/
 * acquireDeploymentLock (jamais de check-then-act sur une donnée
 * partagée). `db` est injectable pour les tests d'intégration
 * (withTestTransaction), comme lib/resources/quotas.ts.
 */
export async function createUser(
  params: { email: string; password: string; name: string },
  db: Queryer = { query },
): Promise<CreateUserResult> {
  const passwordHash = await argon2.hash(params.password)

  try {
    const result = await db.query<{
      id: string
      email: string
      name: string
      role: "user" | "admin"
    }>(
      `
        INSERT INTO users (email, name, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, email, name, role
      `,
      [params.email.trim().toLowerCase(), params.name, passwordHash],
    )

    return { status: "ok", user: result.rows[0] }
  } catch (error) {
    if (isEmailUniqueViolation(error)) {
      return { status: "email_taken" }
    }

    throw error
  }
}

export async function verifyUserPassword(
  email: string,
  password: string,
) {
  const result =
    await query<{
      id: string
      email: string
      name: string
      role: "user" | "admin"
      password_hash: string
    }>(
      `
        SELECT
          id,
          email,
          name,
          role,
          password_hash
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [email.trim()],
    )

  if (
    result.rows.length === 0
  ) {
    return null
  }

  const user =
    result.rows[0]

  if (!user.password_hash) {
    return null
  }

  const valid =
    await argon2.verify(
      user.password_hash,
      password,
    )

  if (!valid) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  }
}
