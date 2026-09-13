import { describe, expect, it, vi } from "vitest"

const {
  mockRequireSession,
  mockQuery,
  mockGetOwnedDatabase,
  mockDeleteAgentDatabase,
  mockDecryptSecret,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockQuery: vi.fn(),
  mockGetOwnedDatabase: vi.fn(),
  mockDeleteAgentDatabase: vi.fn(),
  mockDecryptSecret: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

vi.mock("@/lib/database", () => ({
  query: mockQuery,
}))

vi.mock("@/lib/resources/databases", () => ({
  getOwnedDatabase: mockGetOwnedDatabase,
}))

vi.mock("@/lib/agent/client", () => ({
  deleteAgentDatabase: mockDeleteAgentDatabase,
}))

vi.mock("@/lib/agent/crypto", () => ({
  decryptSecret: mockDecryptSecret,
}))

import { DELETE, GET } from "./route"

const OWNED_DATABASE = {
  id: "db-1",
  user_id: "user-1",
  server_id: "server-1",
  name: "my-db",
  engine: "postgres",
  container_name: "hosting-db-my-db",
  container_id: "c1",
  image: "postgres:16-alpine",
  status: "online",
  database_name: "my_db",
  username: "my_db_user",
  password_encrypted: "iv:tag:ciphertext",
  internal_host: "hosting-db-my-db",
  internal_port: 5432,
  created_at: "2026-01-01T00:00:00.000Z",
  server_name: "Local Docker",
  server_hostname: "localhost",
}

function sessionFor(role: "user" | "admin") {
  return {
    session: {
      session_id: "session-1",
      user_id: "user-1",
      email: "u@example.com",
      name: "Test User",
      role,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    response: null,
  }
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("GET /api/databases/[id] — comportement déjà sécurisé, inchangé", () => {
  it("retourne le mot de passe déchiffré au propriétaire (comportement produit voulu)", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockGetOwnedDatabase.mockResolvedValue({
      database: OWNED_DATABASE,
      response: null,
    })
    mockDecryptSecret.mockReturnValue("plaintext-password")

    const response = await GET(
      new Request("http://panel.local/api/databases/db-1"),
      makeContext("db-1"),
    )

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.database.password).toBe("plaintext-password")
    expect(body.database.password_encrypted).toBeUndefined()
  })
})

describe("DELETE /api/databases/[id] — ne renvoie jamais password_encrypted (H2)", () => {
  it("réponse de suppression ne contient pas password_encrypted", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockGetOwnedDatabase.mockResolvedValue({
      database: OWNED_DATABASE,
      response: null,
    })
    mockDeleteAgentDatabase.mockResolvedValue({ status: "ok" })
    mockQuery.mockResolvedValue({ rows: [] })

    const response = await DELETE(
      new Request("http://panel.local/api/databases/db-1", {
        method: "DELETE",
      }),
      makeContext("db-1"),
    )

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.database).not.toHaveProperty("password_encrypted")
    expect(JSON.stringify(body)).not.toContain("password_encrypted")
    expect(JSON.stringify(body)).not.toContain(
      OWNED_DATABASE.password_encrypted,
    )
    // Le reste de la représentation reste bien présent (pas de sur-filtrage).
    expect(body.database.id).toBe("db-1")
    expect(body.database.name).toBe("my-db")
  })
})
