import { describe, expect, it, vi } from "vitest"

const { mockRequireSession, mockQuery } = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockQuery: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

vi.mock("@/lib/database", () => ({
  query: mockQuery,
}))

import { GET } from "./route"

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

describe("GET /api/servers/[id] — requireAdmin (M3)", () => {
  it("utilisateur normal -> 403", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))

    const response = await GET(
      new Request("http://panel.local/api/servers/server-1"),
      makeContext("server-1"),
    )

    expect(response.status).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it("admin -> 200, comportement fonctionnel inchangé", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("admin"))
    mockQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: "server-1",
          name: "Local Docker",
          hostname: "localhost",
          ip_address: null,
          status: "online",
          agent_version: "0.1.0",
          cpu_usage: null,
          memory_usage: null,
          disk_usage: null,
          memory_total: null,
          memory_used: null,
          disk_total: null,
          disk_used: null,
          uptime_seconds: null,
          last_seen_at: null,
          enrolled_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    })

    const response = await GET(
      new Request("http://panel.local/api/servers/server-1"),
      makeContext("server-1"),
    )

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe("ok")
    expect(body.server.id).toBe("server-1")
  })
})
