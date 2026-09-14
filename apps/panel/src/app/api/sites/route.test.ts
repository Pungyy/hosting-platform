import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockRequireSession,
  mockResolveListScope,
  mockQuery,
  mockPoolConnect,
  mockCreateAgentSite,
  mockDeleteAgentSite,
  mockGetAgentSiteStatuses,
  mockReserveResourceQuota,
  mockReleaseResourceQuota,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockResolveListScope: vi.fn(),
  mockQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockCreateAgentSite: vi.fn(),
  mockDeleteAgentSite: vi.fn(),
  mockGetAgentSiteStatuses: vi.fn(),
  mockReserveResourceQuota: vi.fn(),
  mockReleaseResourceQuota: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

vi.mock("@/lib/auth/roles", () => ({
  resolveListScope: mockResolveListScope,
}))

vi.mock("@/lib/database", () => ({
  query: mockQuery,
  pool: { connect: mockPoolConnect },
}))

vi.mock("@/lib/agent/client", () => ({
  createAgentSite: mockCreateAgentSite,
  deleteAgentSite: mockDeleteAgentSite,
  getAgentSiteStatuses: mockGetAgentSiteStatuses,
}))

vi.mock("@/lib/resources/quotas", () => ({
  MAX_SITES_PER_USER: 10,
  reserveResourceQuota: mockReserveResourceQuota,
  releaseResourceQuota: mockReleaseResourceQuota,
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

function quotaAvailable() {
  return { reserved: true, response: null }
}

function quotaExhausted() {
  return {
    reserved: false,
    response: NextResponse.json(
      {
        status: "error",
        message:
          "Le nombre maximal de sites par utilisateur (10) est atteint.",
      },
      { status: 409 },
    ),
  }
}

function postRequest(body: unknown) {
  return new Request("http://panel.local/api/sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/*
 * Faux client transactionnel (BEGIN/.../COMMIT ou ROLLBACK) — la
 * propriété transactionnelle réelle (ROLLBACK annule bien les DEUX
 * INSERT) est prouvée avec un VRAI Postgres dans
 * route.transaction.test.ts ; ce fichier-ci ne vérifie que le flux de
 * contrôle de la route (quel appel a lieu, dans quel ordre) avec des
 * réponses simulées.
 */
function makeFakeClient(
  queryResponses: Array<
    { resolve: unknown } | { reject: Error }
  >,
) {
  const query = vi.fn()

  for (const response of queryResponses) {
    if ("reject" in response) {
      query.mockRejectedValueOnce(response.reject)
    } else {
      query.mockResolvedValueOnce(response.resolve)
    }
  }

  return { query, release: vi.fn() }
}

describe("POST /api/sites — quota par tenant (finding M3-1)", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    /*
     * Valeurs par défaut réalistes (la vraie fonction retourne
     * toujours une Promise) — sans elles, tout test atteignant le
     * catch englobant échouerait sur `.catch()` d'une valeur
     * `undefined` plutôt que sur l'assertion elle-même.
     */
    mockReleaseResourceQuota.mockResolvedValue(undefined)
    mockDeleteAgentSite.mockResolvedValue({ status: "ok" })
  })

  it("quota déjà atteint -> 409, l'Agent n'est jamais appelé, aucune requête DB", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockReserveResourceQuota.mockResolvedValue(quotaExhausted())

    const response = await POST(postRequest({ name: "test-site" }))

    expect(response.status).toBe(409)
    expect(mockCreateAgentSite).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockReleaseResourceQuota).not.toHaveBeenCalled()
  })

  it("quota disponible -> création normale, aucune libération de quota", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockReserveResourceQuota.mockResolvedValue(quotaAvailable())

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "server-1", name: "Local", hostname: "localhost" }],
      }) // choix du serveur
      .mockResolvedValueOnce({ rows: [] }) // unicité du nom

    const client = makeFakeClient([
      { resolve: undefined }, // BEGIN
      {
        resolve: {
          rows: [
            {
              id: "site-1",
              name: "test-site",
              container_name: "hosting-site-test-site",
              container_id: "c1",
              image: "nginx",
              status: "online",
              created_at: "2026-01-01T00:00:00.000Z",
              server_id: "server-1",
            },
          ],
        },
      }, // INSERT sites
      { resolve: { rows: [] } }, // INSERT domains
      { resolve: undefined }, // COMMIT
    ])
    mockPoolConnect.mockResolvedValue(client)

    mockCreateAgentSite.mockResolvedValue({
      site: {
        id: "c1",
        name: "test-site",
        containerName: "hosting-site-test-site",
        image: "nginx",
        state: "running",
        running: true,
      },
    })

    const response = await POST(postRequest({ name: "test-site" }))

    expect(response.status).toBe(201)
    expect(mockReleaseResourceQuota).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledWith(false)
  })

  it("serveur injoignable après réservation -> quota libéré, 503", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockReserveResourceQuota.mockResolvedValue(quotaAvailable())
    mockQuery.mockResolvedValueOnce({ rows: [] }) // aucun serveur joignable

    const response = await POST(postRequest({ name: "test-site" }))

    expect(response.status).toBe(503)
    expect(mockCreateAgentSite).not.toHaveBeenCalled()
    expect(mockReleaseResourceQuota).toHaveBeenCalledWith("user-1", "site")
  })

  it("nom déjà pris après réservation -> quota libéré, 409", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockReserveResourceQuota.mockResolvedValue(quotaAvailable())
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "server-1", name: "Local", hostname: "localhost" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "existing-site" }] })

    const response = await POST(postRequest({ name: "test-site" }))

    expect(response.status).toBe(409)
    expect(mockCreateAgentSite).not.toHaveBeenCalled()
    expect(mockReleaseResourceQuota).toHaveBeenCalledWith("user-1", "site")
  })

  it("l'Agent échoue après réservation -> quota libéré, 502", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("user"))
    mockReserveResourceQuota.mockResolvedValue(quotaAvailable())
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "server-1", name: "Local", hostname: "localhost" }],
      })
      .mockResolvedValueOnce({ rows: [] })

    mockCreateAgentSite.mockRejectedValue(new Error("Agent injoignable."))

    const response = await POST(postRequest({ name: "test-site" }))

    expect(response.status).toBe(502)
    expect(mockReleaseResourceQuota).toHaveBeenCalledWith("user-1", "site")
  })

  it(
    "échec d'insertion BDD après création Agent -> ROLLBACK, quota " +
      "libéré ET nettoyage du container orphelin",
    async () => {
      mockRequireSession.mockResolvedValue(sessionFor("user"))
      mockReserveResourceQuota.mockResolvedValue(quotaAvailable())
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: "server-1", name: "Local", hostname: "localhost" }],
        })
        .mockResolvedValueOnce({ rows: [] })

      const client = makeFakeClient([
        { resolve: undefined }, // BEGIN
        { reject: new Error("Contrainte violée.") }, // INSERT sites échoue
        { resolve: undefined }, // ROLLBACK
      ])
      mockPoolConnect.mockResolvedValue(client)

      mockCreateAgentSite.mockResolvedValue({
        site: {
          id: "c1",
          name: "test-site",
          containerName: "hosting-site-test-site",
          image: "nginx",
          state: "running",
          running: true,
        },
      })

      const response = await POST(postRequest({ name: "test-site" }))

      expect(response.status).toBe(500)
      expect(client.query).toHaveBeenCalledWith("ROLLBACK")
      expect(client.release).toHaveBeenCalledWith(false)
      expect(mockReleaseResourceQuota).toHaveBeenCalledWith("user-1", "site")
      expect(mockDeleteAgentSite).toHaveBeenCalledWith(
        "server-1",
        "test-site",
      )
    },
  )

  it("un admin créant son propre site reste soumis au même quota (aucun contournement)", async () => {
    mockRequireSession.mockResolvedValue(sessionFor("admin"))
    mockReserveResourceQuota.mockResolvedValue(quotaExhausted())

    const response = await POST(postRequest({ name: "test-site" }))

    expect(response.status).toBe(409)
    expect(mockCreateAgentSite).not.toHaveBeenCalled()
  })

  it(
    "erreur inattendue après réservation (ex. connexion DB perdue sur " +
      "le choix du serveur) -> quota libéré via le catch englobant",
    async () => {
      mockRequireSession.mockResolvedValue(sessionFor("user"))
      mockReserveResourceQuota.mockResolvedValue(quotaAvailable())
      mockQuery.mockRejectedValueOnce(new Error("Connexion perdue."))

      const response = await POST(postRequest({ name: "test-site" }))

      expect(response.status).toBe(500)
      expect(mockReleaseResourceQuota).toHaveBeenCalledWith("user-1", "site")
    },
  )
})
