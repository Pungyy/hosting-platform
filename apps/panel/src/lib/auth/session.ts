import { createHash, randomBytes } from "node:crypto"

import { query } from "@/lib/database"

const SESSION_DURATION_MS =
  7 * 24 * 60 * 60 * 1000

export const SESSION_COOKIE_NAME =
  "hosting_session"

function hashSessionToken(
  token: string,
): string {
  return createHash("sha256")
    .update(token)
    .digest("hex")
}

export async function createSession(
  userId: string,
) {
  const token =
    randomBytes(32).toString("hex")

  const tokenHash =
    hashSessionToken(token)

  const expiresAt =
    new Date(
      Date.now() +
        SESSION_DURATION_MS,
    )

  await query(
    `
      INSERT INTO sessions (
        user_id,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, $3)
    `,
    [
      userId,
      tokenHash,
      expiresAt,
    ],
  )

  return {
    token,
    expiresAt,
  }
}

export async function getSession(
  token: string,
) {
  const tokenHash =
    hashSessionToken(token)

  const result =
    await query<{
      session_id: string
      user_id: string
      email: string
      name: string
      role: "user" | "admin"
      expires_at: string
    }>(
      `
        SELECT
          sessions.id AS session_id,
          users.id AS user_id,
          users.email,
          users.name,
          users.role,
          sessions.expires_at
        FROM sessions
        INNER JOIN users
          ON users.id = sessions.user_id
        WHERE sessions.token_hash = $1
          AND sessions.expires_at > NOW()
        LIMIT 1
      `,
      [tokenHash],
    )

  if (
    result.rows.length === 0
  ) {
    return null
  }

  return result.rows[0]
}

export async function deleteSession(
  token: string,
) {
  const tokenHash =
    hashSessionToken(token)

  await query(
    `
      DELETE FROM sessions
      WHERE token_hash = $1
    `,
    [tokenHash],
  )
}

export async function deleteExpiredSessions() {
  await query(
    `
      DELETE FROM sessions
      WHERE expires_at <= NOW()
    `,
  )
}

export async function getCurrentSession() {
  const { cookies } = await import("next/headers")

  const cookieStore = await cookies()

  const token =
    cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!token) {
    return null
  }

  const session =
    await getSession(token)

  if (!session) {
    cookieStore.delete(SESSION_COOKIE_NAME)
    return null
  }

  return session
}
