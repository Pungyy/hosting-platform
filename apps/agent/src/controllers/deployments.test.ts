import { describe, expect, it, vi } from "vitest"

const { mockDeployDeployment } = vi.hoisted(() => ({
  mockDeployDeployment: vi.fn(),
}))

vi.mock("../services/deployment.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/deployment.js")
  >("../services/deployment.js")

  return {
    ...actual,
    deployDeployment: mockDeployDeployment,
  }
})

import { buildDeploymentController } from "./deployments.js"
import { DeploymentTimeoutError } from "../services/deployment.js"

const VALID_BODY = {
  siteName: "demo-site",
  repositoryUrl: "https://github.com/acme/app",
  branch: "main",
  tenantId: "11111111-1111-4111-8111-111111111111",
}

function makeRequest(body: unknown) {
  return new Request("http://agent.local/deployments/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("buildDeploymentController — timeout (finding H1)", () => {
  it("traduit un DeploymentTimeoutError en 504 avec un champ timeout explicite", async () => {
    mockDeployDeployment.mockRejectedValue(
      new DeploymentTimeoutError(
        "Le build a dépassé le délai maximal de 8 minutes et a été annulé.",
        "logs de build partiels",
      ),
    )

    const result = await buildDeploymentController(
      makeRequest(VALID_BODY),
    )

    expect(result.response).toBeDefined()
    expect(result.response!.status).toBe(504)

    const body = await result.response!.json()
    expect(body.timeout).toBe(true)
    expect(body.status).toBe("error")
    expect(body.message).toContain("8 minutes")

    // Jamais de trace de la stack ou des logs internes dans la réponse.
    expect(JSON.stringify(body)).not.toContain("logs de build partiels")
  })

  it("un échec de build normal (non-timeout) reste un 500 sans champ timeout", async () => {
    mockDeployDeployment.mockRejectedValue(
      new Error("Dockerfile introuvable."),
    )

    const result = await buildDeploymentController(
      makeRequest(VALID_BODY),
    )

    expect(result.response!.status).toBe(500)

    const body = await result.response!.json()
    expect(body.timeout).toBeUndefined()
  })

  it("un déploiement réussi renvoie les données normalement", async () => {
    mockDeployDeployment.mockResolvedValue({
      deploymentId: "dep-1",
      siteName: "demo-site",
      logs: "ok",
    })

    const result = await buildDeploymentController(
      makeRequest(VALID_BODY),
    )

    expect(result.response).toBeUndefined()
    expect(result.data?.status).toBe("ok")
  })
})
