import { describe, expect, it, vi } from "vitest"

const { mockCreateSite } = vi.hoisted(() => ({
  mockCreateSite: vi.fn(),
}))

vi.mock("../services/docker.js", () => ({
  createSite: mockCreateSite,
}))

import { createSiteController } from "./sites.js"

function makeRequest(body: unknown) {
  return new Request("http://agent.local/sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("createSiteController — validation Zod de tenantId", () => {
  it("rejette (400) un tenantId absent, sans jamais appeler createSite", async () => {
    const result = await createSiteController(
      makeRequest({ name: "test-site" }),
    )

    expect(result.response?.status).toBe(400)
    expect(mockCreateSite).not.toHaveBeenCalled()
  })

  it("rejette (400) un tenantId qui n'est pas un UUID valide", async () => {
    const result = await createSiteController(
      makeRequest({ name: "test-site", tenantId: ".*" }),
    )

    expect(result.response?.status).toBe(400)
    expect(mockCreateSite).not.toHaveBeenCalled()
  })

  it("accepte un tenantId UUID valide et le transmet tel quel à createSite", async () => {
    mockCreateSite.mockResolvedValue({
      id: "container-id",
      name: "test-site",
      containerName: "hosting-site-test-site",
      image: "nginxinc/nginx-unprivileged:alpine",
      state: "running",
      running: true,
    })

    const result = await createSiteController(
      makeRequest({ name: "test-site", tenantId: TENANT_A }),
    )

    expect(result.response).toBeUndefined()
    expect(mockCreateSite).toHaveBeenCalledWith({
      name: "test-site",
      tenantId: TENANT_A,
    })
  })
})
