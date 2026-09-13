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

describe("GET /api/servers — requireAdmin (M3)", () => {
  it("utilisateur normal -> 403", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it("admin -> 200, comportement fonctionnel inchangé", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("admin"))
    mockQuery.mockResolvedValue({ rows: [] })

    const response = await GET()

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe("ok")
    expect(body.servers).toEqual([])
  })
})
