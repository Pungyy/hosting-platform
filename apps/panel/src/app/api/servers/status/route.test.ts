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

import { POST } from "./route"

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

describe("POST /api/servers/status — requireAdmin (finding P1 #4)", () => {
  it("utilisateur normal -> 403, aucune requête BDD exécutée", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))

    const response = await POST()

    expect(response.status).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it("admin -> comportement actuel inchangé (200, statuts vérifiés)", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("admin"))
    mockQuery.mockResolvedValue({
      rows: [
        { id: "server-1", name: "Local Docker", last_seen_at: null },
      ],
    })

    const response = await POST()

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe("ok")
    expect(body.checked).toBe(1)
    expect(mockQuery).toHaveBeenCalled()
  })
})
