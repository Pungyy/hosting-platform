import { randomUUID } from "node:crypto"

import type { Session } from "@/lib/auth/session"
import type { Queryer } from "@/lib/database"

/*
 * Fixtures partagées par les tests d'intégration (lib/resources/*.test.ts).
 * Toujours créées à l'intérieur d'une withTestTransaction() — jamais
 * persistées, jamais exécutées contre autre chose que hosting_platform_test.
 */

export async function createTestUser(
  db: Queryer,
  role: Session["role"] = "user",
): Promise<{ id: string; email: string }> {
  const email = `test-fixture-${randomUUID()}@fixtures.internal`

  const result = await db.query<{ id: string }>(
    `
      INSERT INTO users (email, name, role)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [email, "Fixture User", role],
  )

  return { id: result.rows[0].id, email }
}

export function sessionOf(
  user: { id: string },
  role: Session["role"] = "user",
): Session {
  return {
    session_id: randomUUID(),
    user_id: user.id,
    email: "fixture@fixtures.internal",
    name: "Fixture User",
    role,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }
}

export async function createTestServer(db: Queryer): Promise<{ id: string }> {
  const suffix = randomUUID().slice(0, 8)

  const result = await db.query<{ id: string }>(
    `
      INSERT INTO servers (name, hostname, status)
      VALUES ($1, $2, 'offline')
      RETURNING id
    `,
    [`fixture-server-${suffix}`, `fixture-${suffix}.test`],
  )

  return { id: result.rows[0].id }
}

export async function createTestSite(
  db: Queryer,
  params: { userId: string; serverId: string },
): Promise<{ id: string; name: string }> {
  const name = `fixture-site-${randomUUID().slice(0, 8)}`

  const result = await db.query<{ id: string }>(
    `
      INSERT INTO sites (
        user_id, server_id, name, container_name, image, status
      )
      VALUES ($1, $2, $3, $4, 'nginx:alpine', 'online')
      RETURNING id
    `,
    [params.userId, params.serverId, name, `hosting-site-${name}`],
  )

  return { id: result.rows[0].id, name }
}

export async function createTestDatabase(
  db: Queryer,
  params: { userId: string; serverId: string },
): Promise<{ id: string; name: string }> {
  const name = `fixture-db-${randomUUID().slice(0, 8)}`
  const databaseName = name.replace(/-/g, "_")

  const result = await db.query<{ id: string }>(
    `
      INSERT INTO databases (
        user_id, server_id, name, container_name, image,
        database_name, username, password_encrypted,
        internal_host, internal_port
      )
      VALUES (
        $1, $2, $3, $4, 'postgres:16-alpine',
        $5, $6, 'fixture-encrypted-value',
        $7, 5432
      )
      RETURNING id
    `,
    [
      params.userId,
      params.serverId,
      name,
      `hosting-db-${name}`,
      databaseName,
      `${databaseName}_user`,
      `hosting-db-${name}`,
    ],
  )

  return { id: result.rows[0].id, name }
}
