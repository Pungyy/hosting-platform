import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockRequireSession,
  mockGetOwnedSite,
  mockQuery,
  mockDeployAgentSite,
  mockAcquireDeploymentLock,
  mockAcquireTenantDeploymentSlot,
  mockMarkDeploymentSuccess,
  mockMarkDeploymentTerminal,
  mockReleaseTenantDeploymentSlot,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockGetOwnedSite: vi.fn(),
  mockQuery: vi.fn(),
  mockDeployAgentSite: vi.fn(),
  mockAcquireDeploymentLock: vi.fn(),
  mockAcquireTenantDeploymentSlot: vi.fn(),
  mockMarkDeploymentSuccess: vi.fn(),
  mockMarkDeploymentTerminal: vi.fn(),
  mockReleaseTenantDeploymentSlot: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

vi.mock("@/lib/resources/sites", () => ({
  getOwnedSite: mockGetOwnedSite,
}))

vi.mock("@/lib/database", () => ({
  query: mockQuery,
}))

/*
 * Préserve la VRAIE classe AgentRequestError (le code de la route fait
 * `error instanceof AgentRequestError`) tout en mockant uniquement
 * deployAgentSite — importOriginal évite de devoir réimplémenter toute
 * la classe à la main.
 */
vi.mock("@/lib/agent/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/agent/client")>()
  return {
    ...actual,
    deployAgentSite: mockDeployAgentSite,
  }
})

vi.mock("@/lib/resources/deployments", () => ({
  acquireDeploymentLock: mockAcquireDeploymentLock,
  acquireTenantDeploymentSlot: mockAcquireTenantDeploymentSlot,
  markDeploymentSuccess: mockMarkDeploymentSuccess,
  markDeploymentTerminal: mockMarkDeploymentTerminal,
  releaseTenantDeploymentSlot: mockReleaseTenantDeploymentSlot,
}))

import { AgentRequestError } from "@/lib/agent/client"

import { POST } from "./route"

const OWNED_SITE = {
  id: "site-1",
  user_id: "user-1",
  server_id: "server-1",
  name: "test-site",
  container_name: "hosting-site-test-site",
  container_id: "c1",
  image: "nginx",
  status: "online",
  repository_url: "https://github.com/acme/test-site",
  repository_branch: "main",
  build_path: null,
  created_at: "2026-01-01T00:00:00.000Z",
  server_name: "Local Docker",
  server_hostname: "localhost",
}

function sessionFor() {
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

function lockAcquired() {
  return { deploymentId: "deployment-1", response: null }
}

function lockRefused() {
  return {
    deploymentId: null,
    response: Response.json(
      { status: "error", message: "Un déploiement est déjà en cours pour ce site." },
      { status: 409 },
    ),
  }
}

function slotAcquired() {
  return { acquired: true, response: null }
}

function slotRefused() {
  return {
    acquired: false,
    response: Response.json(
      {
        status: "error",
        message: "Vous avez déjà 2 déploiements en cours.",
      },
      { status: 409 },
    ),
  }
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/sites/[id]/deploy — plafond de concurrence par tenant (finding M3-2)", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequireSession.mockResolvedValue(sessionFor())
    mockGetOwnedSite.mockResolvedValue({
      site: OWNED_SITE,
      response: null,
    })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    mockMarkDeploymentTerminal.mockResolvedValue({ applied: true })
    mockReleaseTenantDeploymentSlot.mockResolvedValue(undefined)
  })

  it("verrou H1 refusé (site déjà en déploiement) -> le slot tenant n'est jamais tenté, l'Agent n'est jamais appelé", async () => {
    mockAcquireDeploymentLock.mockResolvedValue(lockRefused())

    const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

    expect(response.status).toBe(409)
    expect(mockAcquireTenantDeploymentSlot).not.toHaveBeenCalled()
    expect(mockDeployAgentSite).not.toHaveBeenCalled()
  })

  it("quota tenant déjà atteint -> deployment terminé 'failed', 409, l'Agent n'est JAMAIS appelé", async () => {
    mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
    mockAcquireTenantDeploymentSlot.mockResolvedValue(slotRefused())

    const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

    expect(response.status).toBe(409)
    expect(mockDeployAgentSite).not.toHaveBeenCalled()
    expect(mockMarkDeploymentTerminal).toHaveBeenCalledWith(
      "deployment-1",
      "failed",
      expect.stringContaining("limite"),
    )
    // Aucun slot n'a jamais été acquis pour ce deployment -> rien à libérer.
    expect(mockReleaseTenantDeploymentSlot).not.toHaveBeenCalled()
  })

  it("succès complet -> le slot tenant est libéré exactement une fois", async () => {
    mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
    mockAcquireTenantDeploymentSlot.mockResolvedValue(slotAcquired())
    mockDeployAgentSite.mockResolvedValue({
      deployment: {
        commitSha: "a".repeat(40),
        imageName: "hosting/test-site:x",
        imageId: "sha256:x",
        logs: "ok",
        container: { name: "hosting-site-test-site", id: "c2", running: true },
      },
    })
    mockMarkDeploymentSuccess.mockResolvedValue({ applied: true })

    const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

    expect(response.status).toBe(200)
    expect(mockReleaseTenantDeploymentSlot).toHaveBeenCalledTimes(1)
    expect(mockReleaseTenantDeploymentSlot).toHaveBeenCalledWith("user-1")
  })

  it("l'Agent échoue -> deployment 'failed', slot tenant libéré (transition confirmée)", async () => {
    mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
    mockAcquireTenantDeploymentSlot.mockResolvedValue(slotAcquired())
    mockDeployAgentSite.mockRejectedValue(new Error("Agent injoignable."))
    mockMarkDeploymentTerminal.mockResolvedValue({ applied: true })

    const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

    expect(response.status).toBe(500)
    expect(mockMarkDeploymentTerminal).toHaveBeenCalledWith(
      "deployment-1",
      "failed",
      expect.any(String),
    )
    expect(mockReleaseTenantDeploymentSlot).toHaveBeenCalledTimes(1)
    expect(mockReleaseTenantDeploymentSlot).toHaveBeenCalledWith("user-1")
  })

  it("timeout Agent (AgentRequestError, timeout=true) -> deployment 'cancelled', slot tenant libéré", async () => {
    mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
    mockAcquireTenantDeploymentSlot.mockResolvedValue(slotAcquired())
    mockDeployAgentSite.mockRejectedValue(
      new AgentRequestError("Timeout.", 504, { timeout: true }),
    )
    mockMarkDeploymentTerminal.mockResolvedValue({ applied: true })

    const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

    expect(response.status).toBe(500)
    expect(mockMarkDeploymentTerminal).toHaveBeenCalledWith(
      "deployment-1",
      "cancelled",
      expect.any(String),
    )
    expect(mockReleaseTenantDeploymentSlot).toHaveBeenCalledTimes(1)
  })

  it(
    "succès Agent mais markDeploymentSuccess devancé par une réclamation " +
      "(applied=false) -> la route NE libère PAS le slot une seconde fois",
    async () => {
      mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
      mockAcquireTenantDeploymentSlot.mockResolvedValue(slotAcquired())
      mockDeployAgentSite.mockResolvedValue({
        deployment: {
          commitSha: "a".repeat(40),
          imageName: "hosting/test-site:x",
          imageId: "sha256:x",
          logs: "ok",
          container: { name: "hosting-site-test-site", id: "c2", running: true },
        },
      })
      mockMarkDeploymentSuccess.mockResolvedValue({ applied: false })

      const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

      expect(response.status).toBe(409)
      // La réclamation a déjà libéré le slot en interne (voir
      // deployments.test.ts) — la route ne doit JAMAIS le refaire.
      expect(mockReleaseTenantDeploymentSlot).not.toHaveBeenCalled()
    },
  )

  it(
    "erreur Agent + markDeploymentTerminal devancé par une réclamation " +
      "(applied=false) -> le slot n'est PAS libéré une seconde fois",
    async () => {
      mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
      mockAcquireTenantDeploymentSlot.mockResolvedValue(slotAcquired())
      mockDeployAgentSite.mockRejectedValue(new Error("Agent injoignable."))
      mockMarkDeploymentTerminal.mockResolvedValue({ applied: false })

      const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

      expect(response.status).toBe(500)
      expect(mockReleaseTenantDeploymentSlot).not.toHaveBeenCalled()
    },
  )

  it(
    "erreur Agent ET markDeploymentTerminal échoue lui-même (ex. DB indisponible) -> " +
      "le slot n'est PAS libéré (fail-closed : un slot temporairement perdu est " +
      "acceptable, jamais un double décrément incertain)",
    async () => {
      mockAcquireDeploymentLock.mockResolvedValue(lockAcquired())
      mockAcquireTenantDeploymentSlot.mockResolvedValue(slotAcquired())
      mockDeployAgentSite.mockRejectedValue(new Error("Agent injoignable."))
      mockMarkDeploymentTerminal.mockRejectedValue(
        new Error("Connexion DB perdue."),
      )

      const response = await POST(new Request("http://panel.local"), makeContext("site-1"))

      expect(response.status).toBe(500)
      expect(mockReleaseTenantDeploymentSlot).not.toHaveBeenCalled()
    },
  )
})
