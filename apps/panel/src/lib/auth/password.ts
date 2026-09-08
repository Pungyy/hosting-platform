import argon2 from "argon2"

import { query } from "@/lib/database"

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
