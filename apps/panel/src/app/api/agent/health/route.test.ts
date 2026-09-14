import { NextResponse } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockRequireSession } = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

import { GET } from "./route"

function authenticated() {
  return {
    session: {
      session_id: "session-1",
      user_id: "user-1",
      email: "u@example.com",
      name: "Test User",
      role: "user" as const,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    response: null,
  }
}

function unauthenticated() {
  return {
    session: null,
    response: NextResponse.json(
      {
        status: "error",
        message: "Authentification requise.",
      },
      { status: 401 },
    ),
  }
}

const mockFetch = vi.fn()

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GET /api/agent/health — requireSession (finding M1)", () => {
  it("aucune session -> 401, l'Agent n'est jamais contacté", async () => {
    mockRequireSession.mockResolvedValue(unauthenticated())
    vi.stubGlobal("fetch", mockFetch)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("session invalide -> 401, l'Agent n'est jamais contacté", async () => {
    /*
     * requireSession() ne distingue pas "aucun cookie" de "cookie
     * présent mais session invalide/expirée" — getCurrentSession()
     * renvoie null dans les deux cas (voir lib/auth/session.ts). Le
     * handler délègue entièrement cette décision à requireSession(),
     * donc le comportement observable de la route est nécessairement
     * identique aux deux scénarios : c'est exactement le point testé
     * ici séparément du cas "aucune session".
     */
    mockRequireSession.mockResolvedValue(unauthenticated())
    vi.stubGlobal("fetch", mockFetch)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("session valide + Agent OK -> 200, status online (comportement inchangé)", async () => {
    mockRequireSession.mockResolvedValue(authenticated())
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: "online",
          service: "hosting-agent",
          version: "0.1.0",
        }),
    })
    vi.stubGlobal("fetch", mockFetch)

    const response = await GET()

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe("online")
    expect(body.agent.service).toBe("hosting-agent")
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4000/health",
      { cache: "no-store" },
    )
  })

  it("session valide + Agent répond en erreur HTTP -> comportement offline inchangé (502)", async () => {
    mockRequireSession.mockResolvedValue(authenticated())
    mockFetch.mockResolvedValue({
      ok: false,
    })
    vi.stubGlobal("fetch", mockFetch)

    const response = await GET()

    expect(response.status).toBe(502)

    const body = await response.json()
    expect(body.status).toBe("offline")
  })

  it("session valide + erreur réseau -> comportement offline inchangé (503)", async () => {
    mockRequireSession.mockResolvedValue(authenticated())
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"))
    vi.stubGlobal("fetch", mockFetch)

    const response = await GET()

    expect(response.status).toBe(503)

    const body = await response.json()
    expect(body.status).toBe("offline")
  })
})
