import { beforeEach, describe, expect, it, vi } from "vitest"

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const { mockContainer, mockNetwork, mockDockerInstance } = vi.hoisted(
  () => {
    const mockContainer = {
      inspect: vi.fn(),
    }

    const mockNetwork = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    const mockDockerInstance = {
      listContainers: vi.fn(),
      getContainer: vi.fn(),
      createContainer: vi.fn(),
      listNetworks: vi.fn(),
      createNetwork: vi.fn(),
      getNetwork: vi.fn(),
      getImage: vi.fn(),
    }

    return { mockContainer, mockNetwork, mockDockerInstance }
  },
)

vi.mock("dockerode", () => ({
  default: vi.fn().mockImplementation(() => mockDockerInstance),
}))

vi.mock("./traefik.js", () => ({
  addSiteToTraefik: vi.fn(),
  removeSiteFromTraefik: vi.fn(),
}))

import {
  createDeploymentContainer,
  getTenantNetworkName,
  migrateSiteToTenantNetwork,
  validateTenantId,
} from "./docker.js"

beforeEach(() => {
  vi.clearAllMocks()
  mockDockerInstance.getContainer.mockReturnValue(mockContainer)
  mockDockerInstance.getNetwork.mockReturnValue(mockNetwork)
})

describe("validateTenantId", () => {
  it("accepte un UUID minuscule bien formé", () => {
    expect(() => validateTenantId(TENANT_A)).not.toThrow()
  })

  it("rejette les valeurs malveillantes ou malformées", () => {
    const invalidValues = [
      "",
      ".*",
      "not-a-uuid",
      // injection visant à cibler un container hors du préfixe attendu
      "z$|^/regardscroises-db$",
      // majuscules : rejetées volontairement (Postgres renvoie des
      // UUID en minuscules pour les colonnes users.id/sites.user_id)
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      // un caractère de moins que la longueur attendue
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa",
      "../../etc",
    ]

    for (const value of invalidValues) {
      expect(() => validateTenantId(value)).toThrow(
        "Identifiant de tenant invalide.",
      )
    }
  })
})

describe("getTenantNetworkName", () => {
  it("est déterministe : le même tenant donne toujours le même nom", () => {
    expect(getTenantNetworkName(TENANT_A)).toBe(
      getTenantNetworkName(TENANT_A),
    )
    expect(getTenantNetworkName(TENANT_A)).toBe(
      `hosting-tenant-${TENANT_A}`,
    )
  })

  it("deux tenants différents obtiennent deux réseaux différents", () => {
    expect(getTenantNetworkName(TENANT_A)).not.toBe(
      getTenantNetworkName(TENANT_B),
    )
  })

  it("rejette un tenantId invalide avant de construire un nom de réseau", () => {
    expect(() => getTenantNetworkName(".*")).toThrow(
      "Identifiant de tenant invalide.",
    )
  })
})

describe("createDeploymentContainer — cohérence du label tenant au redéploiement", () => {
  it("refuse le redéploiement si le tenant fourni diffère du label existant, avant toute création de container", async () => {
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
      createDeploymentContainer({
        siteName: "test-site",
        imageName: "hosting/test-site:abc",
        tenantId: TENANT_B,
      }),
    ).rejects.toThrow(
      "Le tenant fourni ne correspond pas au propriétaire existant de ce site.",
    )

    expect(mockDockerInstance.getImage).not.toHaveBeenCalled()
    expect(mockDockerInstance.createContainer).not.toHaveBeenCalled()
  })

  it("laisse passer le redéploiement quand le tenant fourni correspond au label existant", async () => {
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
    mockDockerInstance.getImage.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(
          new Error("SENTINEL_PAST_CONSISTENCY_CHECK"),
        ),
    })

    await expect(
      createDeploymentContainer({
        siteName: "test-site",
        imageName: "hosting/test-site:abc",
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow("SENTINEL_PAST_CONSISTENCY_CHECK")

    expect(mockDockerInstance.getImage).toHaveBeenCalled()
  })

  it("ne bloque pas un premier déploiement (aucun container existant)", async () => {
    mockDockerInstance.listContainers.mockResolvedValue([])
    mockDockerInstance.getImage.mockReturnValue({
      inspect: vi
        .fn()
        .mockRejectedValue(
          new Error("SENTINEL_PAST_CONSISTENCY_CHECK"),
        ),
    })

    await expect(
      createDeploymentContainer({
        siteName: "test-site",
        imageName: "hosting/test-site:abc",
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow("SENTINEL_PAST_CONSISTENCY_CHECK")
  })

  it("rejette un tenantId invalide avant tout appel Docker", async () => {
    await expect(
      createDeploymentContainer({
        siteName: "test-site",
        imageName: "hosting/test-site:abc",
        tenantId: ".*",
      }),
    ).rejects.toThrow("Identifiant de tenant invalide.")

    expect(mockDockerInstance.listContainers).not.toHaveBeenCalled()
  })
})

describe("migrateSiteToTenantNetwork — idempotence", () => {
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

    const result = await migrateSiteToTenantNetwork(
      "test-site",
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

    const result = await migrateSiteToTenantNetwork(
      "test-site",
      TENANT_A,
    )

    expect(result.connected).toBe(true)
    expect(mockNetwork.connect).not.toHaveBeenCalled()
  })

  it("refuse de migrer un site vers un tenant différent de son label existant", async () => {
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
      migrateSiteToTenantNetwork("test-site", TENANT_B),
    ).rejects.toThrow(
      "Le tenant fourni ne correspond pas au propriétaire existant de ce site.",
    )

    expect(mockNetwork.connect).not.toHaveBeenCalled()
  })
})
