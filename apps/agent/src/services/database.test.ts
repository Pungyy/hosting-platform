import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockContainer, mockNetwork, mockVolume, mockDockerInstance } =
  vi.hoisted(() => {
    const mockContainer = {
      inspect: vi.fn(),
      start: vi.fn(),
      remove: vi.fn(),
    }

    const mockNetwork = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    const mockVolume = {
      remove: vi.fn(),
    }

    const mockDockerInstance = {
      listContainers: vi.fn(),
      getContainer: vi.fn(),
      createContainer: vi.fn(),
      listNetworks: vi.fn(),
      createNetwork: vi.fn(),
      getNetwork: vi.fn(),
      createVolume: vi.fn(),
      getVolume: vi.fn(),
    }

    return {
      mockContainer,
      mockNetwork,
      mockVolume,
      mockDockerInstance,
    }
  })

vi.mock("dockerode", () => ({
  default: vi.fn().mockImplementation(() => mockDockerInstance),
}))

import { getTenantNetworkName } from "./docker.js"
import {
  createDatabase,
  migrateDatabaseToTenantNetwork,
} from "./database.js"

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

beforeEach(() => {
  vi.clearAllMocks()
  mockDockerInstance.getContainer.mockReturnValue(mockContainer)
  mockDockerInstance.getNetwork.mockReturnValue(mockNetwork)
  mockDockerInstance.getVolume.mockReturnValue(mockVolume)
})

describe("createDatabase — validation du tenantId avant tout appel Docker", () => {
  it("rejette un tenantId invalide sans jamais créer de volume ni de container", async () => {
    await expect(
      createDatabase({
        name: "test-db",
        engine: "postgres",
        tenantId: ".*",
      }),
    ).rejects.toThrow("Identifiant de tenant invalide.")

    expect(mockDockerInstance.listContainers).not.toHaveBeenCalled()
    expect(mockDockerInstance.createVolume).not.toHaveBeenCalled()
    expect(mockDockerInstance.createContainer).not.toHaveBeenCalled()
  })

  it("attache le container au réseau hosting-tenant-<uuid> exact du tenant fourni", async () => {
    mockDockerInstance.listContainers.mockResolvedValue([])
    mockDockerInstance.listNetworks.mockResolvedValue([])
    mockDockerInstance.createNetwork.mockResolvedValue({})
    mockDockerInstance.createVolume.mockResolvedValue({})
    mockDockerInstance.createContainer.mockResolvedValue(mockContainer)
    mockContainer.start.mockResolvedValue(undefined)
    mockContainer.inspect.mockResolvedValue({
      Id: "new-db-id",
      State: { Status: "running", Running: true },
    })

    await createDatabase({
      name: "test-db",
      engine: "postgres",
      tenantId: TENANT_A,
    })

    const createContainerArgs =
      mockDockerInstance.createContainer.mock.calls[0][0]

    const expectedNetwork = getTenantNetworkName(TENANT_A)

    expect(
      Object.keys(
        createContainerArgs.NetworkingConfig.EndpointsConfig,
      ),
    ).toEqual([expectedNetwork])

    expect(createContainerArgs.Labels["hosting.platform.tenant"]).toBe(
      TENANT_A,
    )
  })
})

describe("migrateDatabaseToTenantNetwork — idempotence et cohérence du label", () => {
  it("connecte le container au réseau tenant s'il n'y est pas déjà", async () => {
    mockDockerInstance.listContainers.mockResolvedValue([
      { Id: "existing-id" },
    ])
    mockContainer.inspect.mockResolvedValue({
      Id: "existing-id",
      Config: { Labels: {} },
      NetworkSettings: { Networks: {} },
    })
    mockDockerInstance.listNetworks.mockResolvedValue([])
    mockDockerInstance.createNetwork.mockResolvedValue({})

    const result = await migrateDatabaseToTenantNetwork(
      "test-db",
      TENANT_A,
    )

    expect(result.connected).toBe(true)
    expect(mockNetwork.connect).toHaveBeenCalledTimes(1)
  })

  it("ne reconnecte pas un container déjà attaché (idempotent)", async () => {
    const tenantNetwork = getTenantNetworkName(TENANT_A)

    mockDockerInstance.listContainers.mockResolvedValue([
      { Id: "existing-id" },
    ])
    mockContainer.inspect.mockResolvedValue({
      Id: "existing-id",
      Config: { Labels: {} },
      NetworkSettings: {
        Networks: { [tenantNetwork]: {} },
      },
    })
    mockDockerInstance.listNetworks.mockResolvedValue([
      { Id: "net-id", Name: tenantNetwork },
    ])

    const result = await migrateDatabaseToTenantNetwork(
      "test-db",
      TENANT_A,
    )

    expect(result.connected).toBe(true)
    expect(mockNetwork.connect).not.toHaveBeenCalled()
  })

  it("refuse de migrer une base vers un tenant différent de son label existant", async () => {
    mockDockerInstance.listContainers.mockResolvedValue([
      { Id: "existing-id" },
    ])
    mockContainer.inspect.mockResolvedValue({
      Id: "existing-id",
      Config: {
        Labels: { "hosting.platform.tenant": TENANT_A },
      },
      NetworkSettings: { Networks: {} },
    })

    await expect(
      migrateDatabaseToTenantNetwork("test-db", TENANT_B),
    ).rejects.toThrow(
      "Le tenant fourni ne correspond pas au propriétaire existant de cette base.",
    )

    expect(mockNetwork.connect).not.toHaveBeenCalled()
  })
})
