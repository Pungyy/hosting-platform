import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  createSite,
  getTenantNetworkName,
  migrateSiteToTenantNetwork,
  TENANT_CONTAINER_EXTRA_HOSTS,
  validateTenantId,
} from "./docker.js"

beforeEach(() => {
  vi.clearAllMocks()
  mockDockerInstance.getContainer.mockReturnValue(mockContainer)
  mockDockerInstance.getNetwork.mockReturnValue(mockNetwork)
})

afterEach(() => {
  vi.useRealTimers()
})

/*
 * Distingue les appels listContainers() selon le pattern de nom filtré
 * (containerName final vs <containerName>-deployment temporaire) —
 * nécessaire pour piloter précisément les étapes successives de
 * createDeploymentContainer() (existingContainer, oldTemporaryContainer,
 * oldContainer, finalContainer), qui interrogent toutes le même mock
 * listContainers mais avec des filtres différents.
 */
function nameFilterOf(
  options: unknown,
): string {
  const parsed = JSON.parse(
    (options as { filters: string }).filters,
  )
  return parsed.name[0] as string
}

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

describe("createSite — durcissement host.docker.internal", () => {
  it("transmet TENANT_CONTAINER_EXTRA_HOSTS (127.0.0.1 et ::1) à docker.createContainer()", async () => {
    mockDockerInstance.listContainers.mockResolvedValue([])
    mockDockerInstance.listNetworks.mockResolvedValue([])
    mockDockerInstance.createNetwork.mockResolvedValue({})
    mockDockerInstance.createContainer.mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: "site-id",
        State: { Status: "running", Running: true },
      }),
    })

    await createSite({ name: "test-site", tenantId: TENANT_A })

    expect(mockDockerInstance.createContainer).toHaveBeenCalledTimes(1)

    const args =
      mockDockerInstance.createContainer.mock.calls[0][0]

    expect(args.HostConfig.ExtraHosts).toEqual(
      TENANT_CONTAINER_EXTRA_HOSTS,
    )
    expect(args.HostConfig.ExtraHosts).toEqual([
      "host.docker.internal:127.0.0.1",
      "host.docker.internal:::1",
    ])
  })
})

describe("createDeploymentContainer — durcissement host.docker.internal", () => {
  it("transmet TENANT_CONTAINER_EXTRA_HOSTS (127.0.0.1 et ::1) à docker.createContainer()", async () => {
    mockDockerInstance.listContainers.mockResolvedValue([])
    mockDockerInstance.listNetworks.mockResolvedValue([])
    mockDockerInstance.createNetwork.mockResolvedValue({})
    mockDockerInstance.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Config: { ExposedPorts: { "8080/tcp": {} } },
      }),
    })
    mockDockerInstance.createContainer.mockResolvedValue({})

    // Le flux continue après createContainer (start, inspect, etc.) —
    // non mocké ici puisque seul l'appel createContainer nous
    // intéresse pour ce test. On avale l'erreur qui en résultera.
    await createDeploymentContainer({
      siteName: "test-site",
      imageName: "hosting/test-site:abc",
      tenantId: TENANT_A,
    }).catch(() => {})

    expect(mockDockerInstance.createContainer).toHaveBeenCalledTimes(1)

    const args =
      mockDockerInstance.createContainer.mock.calls[0][0]

    expect(args.HostConfig.ExtraHosts).toEqual(
      TENANT_CONTAINER_EXTRA_HOSTS,
    )
  })
})

/*
 * Finding H1, "timeout incomplet" (revue indépendante du commit
 * 2054172, §2/§4) : vérifie que le MÊME abortSignal transmis par
 * l'appelant se retrouve bien sur chaque opération dockerode qui le
 * supporte nativement (create/start/inspect/list — vérifié dans
 * @types/dockerode), et que les opérations qui ne le supportent pas
 * (remove/rename) sont bornées par withOperationTimeout() plutôt que
 * de pouvoir attendre indéfiniment.
 */
describe("createDeploymentContainer — propagation de l'abortSignal (finding H1)", () => {
  it("transmet le même abortSignal à createContainer/start/inspect/listNetworks/listContainers", async () => {
    const abortController = new AbortController()

    mockDockerInstance.listContainers.mockResolvedValue([])
    mockDockerInstance.listNetworks.mockResolvedValue([])
    mockDockerInstance.createNetwork.mockResolvedValue({})
    mockDockerInstance.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Config: { ExposedPorts: { "8080/tcp": {} } },
      }),
    })

    const newContainerMock = {
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: "new-container-id",
        State: { Running: true, Status: "running" },
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    }
    mockDockerInstance.createContainer.mockResolvedValue(
      newContainerMock,
    )

    /*
     * Après le renommage, createDeploymentContainer recherche le
     * container sous son nom final — on simule qu'il est bien trouvé
     * cette fois (listContainers renvoie un résultat pour CET appel
     * précis, tous les autres appels "nom final" ayant renvoyé [] —
     * existingContainer et oldContainer, avant la création).
     */
    let containerNameCalls = 0
    mockDockerInstance.listContainers.mockImplementation(
      async (options: unknown) => {
        const pattern = nameFilterOf(options)

        if (pattern.includes("-deployment$")) {
          return []
        }

        containerNameCalls += 1

        // 1er appel = existingContainer, 2e = oldContainer : aucun
        // container trouvé. 3e = finalContainer (après rename) :
        // trouvé.
        if (containerNameCalls < 3) {
          return []
        }

        return [{ Id: "new-container-id" }]
      },
    )
    mockDockerInstance.getContainer.mockReturnValue(newContainerMock)

    const result = await createDeploymentContainer({
      siteName: "test-site",
      imageName: "hosting/test-site:abc",
      tenantId: TENANT_A,
      abortSignal: abortController.signal,
    })

    expect(result.running).toBe(true)

    expect(
      mockDockerInstance.createContainer.mock.calls[0][0]
        .abortSignal,
    ).toBe(abortController.signal)

    expect(newContainerMock.start).toHaveBeenCalledWith({
      abortSignal: abortController.signal,
    })

    expect(newContainerMock.inspect).toHaveBeenCalledWith({
      abortSignal: abortController.signal,
    })

    for (const call of mockDockerInstance.listContainers.mock
      .calls) {
      expect(call[0].abortSignal).toBe(abortController.signal)
    }

    for (const call of mockDockerInstance.listNetworks.mock
      .calls) {
      expect(call[0].abortSignal).toBe(abortController.signal)
    }

    /*
     * rename() n'accepte pas d'AbortSignal typé (vérifié dans
     * @types/dockerode) — appelé sans ce champ, mais toujours borné
     * par withOperationTimeout (voir le test suivant).
     */
    expect(newContainerMock.rename).toHaveBeenCalledWith({
      name: "hosting-site-test-site",
    })
  })

  it("un remove() de l'ancien container qui ne répond jamais est borné par un timeout dédié (pas d'attente infinie)", async () => {
    vi.useFakeTimers()

    mockDockerInstance.listNetworks.mockResolvedValue([])
    mockDockerInstance.createNetwork.mockResolvedValue({})
    mockDockerInstance.getImage.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Config: { ExposedPorts: { "8080/tcp": {} } },
      }),
    })

    const newContainerMock = {
      start: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        Id: "new-container-id",
        State: { Running: true, Status: "running" },
      }),
      // Nettoyage best-effort du nouveau container si la suppression
      // de l'ancien échoue : doit réussir vite pour ne pas ajouter une
      // seconde attente de 30 s dans ce test.
      remove: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    }
    mockDockerInstance.createContainer.mockResolvedValue(
      newContainerMock,
    )

    let containerNameCalls = 0
    mockDockerInstance.listContainers.mockImplementation(
      async (options: unknown) => {
        const pattern = nameFilterOf(options)

        if (pattern.includes("-deployment$")) {
          return []
        }

        containerNameCalls += 1

        // 1er appel = existingContainer : aucun. 2e = oldContainer :
        // trouvé — c'est celui dont remove() ne répondra jamais.
        if (containerNameCalls === 1) {
          return []
        }

        return [{ Id: "old-container-id" }]
      },
    )

    // L'ancien container : sa suppression ne se termine JAMAIS d'elle-
    // même (simule un daemon Docker qui ne répond plus) — seul
    // withOperationTimeout doit borner cette attente.
    const oldContainerMock = {
      remove: vi.fn(() => new Promise(() => {})),
    }
    mockDockerInstance.getContainer.mockReturnValue(oldContainerMock)

    const promise = createDeploymentContainer({
      siteName: "test-site",
      imageName: "hosting/test-site:abc",
      tenantId: TENANT_A,
    })
    promise.catch(() => {})

    // Bien après le délai dédié (30 s) — l'attente ne doit jamais être
    // infinie.
    await vi.advanceTimersByTimeAsync(31_000)

    await expect(promise).rejects.toThrow(
      /Impossible de supprimer l'ancien container/,
    )

    expect(oldContainerMock.remove).toHaveBeenCalledWith({
      force: true,
    })
  })
})
