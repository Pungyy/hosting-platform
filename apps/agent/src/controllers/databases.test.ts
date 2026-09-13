import { describe, expect, it, vi } from "vitest"

const { mockCreateDatabase } = vi.hoisted(() => ({
  mockCreateDatabase: vi.fn(),
}))

vi.mock("../services/database.js", () => ({
  createDatabase: mockCreateDatabase,
}))

import { createDatabaseController } from "./databases.js"

function makeRequest(body: unknown) {
  return new Request("http://agent.local/databases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("createDatabaseController — validation Zod de tenantId", () => {
  it("rejette (400) un tenantId absent, sans jamais appeler createDatabase", async () => {
    const result = await createDatabaseController(
      makeRequest({ name: "test-db", engine: "postgres" }),
    )

    expect(result.response?.status).toBe(400)
    expect(mockCreateDatabase).not.toHaveBeenCalled()
  })

  it("rejette (400) un tenantId qui n'est pas un UUID valide", async () => {
    const result = await createDatabaseController(
      makeRequest({
        name: "test-db",
        engine: "postgres",
        tenantId: "z$|^/regardscroises-db$",
      }),
    )

    expect(result.response?.status).toBe(400)
    expect(mockCreateDatabase).not.toHaveBeenCalled()
  })

  it("accepte un tenantId UUID valide et le transmet tel quel à createDatabase", async () => {
    mockCreateDatabase.mockResolvedValue({
      id: "container-id",
      name: "test-db",
      containerName: "hosting-db-test-db",
      image: "postgres:16-alpine",
      engine: "postgres",
      databaseName: "test_db",
      username: "test_db_user",
      password: "secret",
      port: 5432,
      state: "running",
      running: true,
    })

    const result = await createDatabaseController(
      makeRequest({
        name: "test-db",
        engine: "postgres",
        tenantId: TENANT_A,
      }),
    )

    expect(result.response).toBeUndefined()
    expect(mockCreateDatabase).toHaveBeenCalledWith({
      name: "test-db",
      engine: "postgres",
      tenantId: TENANT_A,
    })
  })
})
