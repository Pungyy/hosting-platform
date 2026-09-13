import { describe, expect, it, vi } from "vitest"

const {
  mockRequireSession,
  mockQuery,
  mockGetAgentSiteStatuses,
  mockGetAgentHealth,
  mockCreateAgentSite,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockQuery: vi.fn(),
  mockGetAgentSiteStatuses: vi.fn(),
  mockGetAgentHealth: vi.fn(),
  mockCreateAgentSite: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

vi.mock("@/lib/database", () => ({
  query: mockQuery,
}))

vi.mock("@/lib/agent/client", () => ({
  getAgentSiteStatuses: mockGetAgentSiteStatuses,
  getAgentHealth: mockGetAgentHealth,
  createAgentSite: mockCreateAgentSite,
}))

import { GET, POST } from "./route"

function sessionFor(role: "user" | "admin", userId = "user-1") {
  return {
    session: {
      session_id: "session-1",
      user_id: userId,
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

describe("GET /api/servers/[id]/sites — requireAdmin (H1)", () => {
  it("utilisateur normal -> 403, sans jamais interroger l'agent", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))

    const response = await GET(
      new Request("http://panel.local/api/servers/server-1/sites"),
      makeContext("server-1"),
    )

    expect(response.status).toBe(403)
    expect(mockGetAgentSiteStatuses).not.toHaveBeenCalled()
  })

  it("admin -> 200, comportement fonctionnel inchangé (pas de filtrage tenant nécessaire)", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("admin"))
    mockGetAgentSiteStatuses.mockResolvedValue({
      status: "ok",
      sites: [
        {
          name: "tenant-a-site",
          containerId: "c1",
          containerName: "hosting-site-tenant-a-site",
          status: "running",
          running: true,
        },
        {
          name: "tenant-b-site",
          containerId: "c2",
          containerName: "hosting-site-tenant-b-site",
          status: "running",
          running: true,
        },
      ],
    })

    const response = await GET(
      new Request("http://panel.local/api/servers/server-1/sites"),
      makeContext("server-1"),
    )

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.sites).toHaveLength(2)
  })
})

describe("POST /api/servers/[id]/sites — requireAdmin + tenantId dérivé côté serveur (M1/M2)", () => {
  it("utilisateur normal -> 403, sans jamais appeler l'agent", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))

    const response = await POST(
      new Request("http://panel.local/api/servers/server-1/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new-site" }),
      }),
      makeContext("server-1"),
    )

    expect(response.status).toBe(403)
    expect(mockCreateAgentSite).not.toHaveBeenCalled()
  })

  it("admin -> transmet tenantId = session.user_id à l'agent, jamais une valeur du client", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("admin", "admin-42"))

    mockQuery
      // SELECT serveur
      .mockResolvedValueOnce({
        rows: [
          {
            id: "server-1",
            name: "Local Docker",
            hostname: "localhost",
            status: "online",
          },
        ],
      })
      // SELECT nom de site déjà pris
      .mockResolvedValueOnce({ rows: [] })
      // INSERT INTO sites
      .mockResolvedValueOnce({
        rows: [
          {
            id: "site-1",
            name: "new-site",
            container_name: "hosting-site-new-site",
            container_id: "c1",
            image: "nginxinc/nginx-unprivileged:alpine",
            status: "online",
            created_at: "2026-01-01T00:00:00.000Z",
            server_id: "server-1",
          },
        ],
      })
      // INSERT INTO domains
      .mockResolvedValueOnce({ rows: [] })

    mockGetAgentHealth.mockResolvedValue({ status: "online" })

    mockCreateAgentSite.mockResolvedValue({
      site: {
        id: "c1",
        name: "new-site",
        containerName: "hosting-site-new-site",
        image: "nginxinc/nginx-unprivileged:alpine",
        state: "running",
        running: true,
      },
    })

    // Un client malveillant tente de fournir son propre tenantId dans le
    // corps de la requête — il ne doit jamais être utilisé.
    const response = await POST(
      new Request("http://panel.local/api/servers/server-1/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "new-site",
          tenantId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
      makeContext("server-1"),
    )

    expect(response.status).toBe(201)
    expect(mockCreateAgentSite).toHaveBeenCalledWith("server-1", {
      name: "new-site",
      tenantId: "admin-42",
    })
  })
})
