import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

const FAKE_COMMIT_SHA = "a".repeat(40)
const BUILD_TIMEOUT_MS = 8 * 60 * 1000

const {
  mockBuildImage,
  mockFollowProgress,
  mockGetImage,
  mockImageInspect,
  mockImageRemove,
  mockDockerInstance,
} = vi.hoisted(() => {
  const mockImageInspect = vi.fn()
  const mockImageRemove = vi.fn().mockResolvedValue(undefined)
  const mockImage = {
    inspect: mockImageInspect,
    remove: mockImageRemove,
  }
  const mockGetImage = vi.fn(() => mockImage)
  const mockBuildImage = vi.fn()
  const mockFollowProgress = vi.fn()

  const mockDockerInstance = {
    buildImage: mockBuildImage,
    getImage: mockGetImage,
    listImages: vi.fn().mockResolvedValue([]),
    listContainers: vi.fn().mockResolvedValue([]),
    modem: { followProgress: mockFollowProgress },
  }

  return {
    mockBuildImage,
    mockFollowProgress,
    mockGetImage,
    mockImageInspect,
    mockImageRemove,
    mockDockerInstance,
  }
})

vi.mock("dockerode", () => ({
  default: vi.fn().mockImplementation(() => mockDockerInstance),
}))

const { mockCloneRepository } = vi.hoisted(() => ({
  mockCloneRepository: vi.fn(),
}))

vi.mock("./git.js", () => ({
  cloneRepository: mockCloneRepository,
}))

const { mockCreateDeploymentContainer } = vi.hoisted(() => ({
  mockCreateDeploymentContainer: vi.fn(),
}))

vi.mock("./docker.js", () => ({
  createDeploymentContainer: mockCreateDeploymentContainer,
  /*
   * Réimplémentation fidèle (mais sans le timer de secours) de la
   * fonction réelle de docker.ts : exécute juste l'opération. Avant ce
   * correctif, ce mock de module omettait totalement
   * withOperationTimeout, si bien que cleanupOldImages() l'appelait
   * comme `undefined(...)` — l'erreur résultante était avalée en
   * silence par le catch existant autour de currentImage.inspect(),
   * masquant le problème plutôt que de le révéler.
   */
  withOperationTimeout: async (
    operation: () => Promise<unknown>,
  ) => operation(),
}))

const { mockFsRm } = vi.hoisted(() => ({
  mockFsRm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("node:fs", () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isFile: () => true }),
    rm: mockFsRm,
  },
}))

import {
  buildDeployment,
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_POST_BUILD_TIMEOUT_MS,
  deployDeployment,
  DeploymentTimeoutError,
  MAX_DEPLOYMENT_TIMEOUT_MS,
  MIN_DEPLOYMENT_TIMEOUT_MS,
  resolveDeploymentTimeouts,
} from "./deployment.js"

const TENANT_ID = "11111111-1111-4111-8111-111111111111"

/*
 * Simule un stream de build "normal" : docker.buildImage() résout
 * immédiatement, puis followProgress() appelle onFinished tout de
 * suite avec succès — comportement d'un build rapide sans erreur.
 */
function mockFastSuccessfulBuild() {
  mockBuildImage.mockImplementation(() =>
    Promise.resolve({ __fake: "stream" }),
  )
  mockFollowProgress.mockImplementation((_stream, onFinished) => {
    onFinished(null, [])
  })
  mockImageInspect.mockResolvedValue({ Id: "sha256:fakeimageid" })
}

/*
 * Simule un build qui ne se termine JAMAIS de lui-même (followProgress
 * n'appelle onFinished que si le abortSignal transmis à buildImage()
 * est déclenché) — reproduit un `RUN sleep infinity` ou un build qui
 * n'écrirait aucune sortie, pour vérifier que SEUL le timeout dur
 * arrête réellement l'opération.
 */
function mockHangingBuild() {
  mockBuildImage.mockImplementation((_file, opts) => {
    return Promise.resolve({ __abortSignal: opts.abortSignal })
  })

  mockFollowProgress.mockImplementation((stream, onFinished) => {
    const signal = (stream as { __abortSignal?: AbortSignal })
      .__abortSignal

    signal?.addEventListener("abort", () => {
      const abortError = new Error(
        "The operation was aborted",
      )
      abortError.name = "AbortError"
      onFinished(abortError, null)
    })
    // N'appelle jamais onFinished spontanément.
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCloneRepository.mockResolvedValue({
    repositoryUrl: "https://github.com/acme/app",
    branch: "main",
    destination: "/tmp/fake",
    commitSha: FAKE_COMMIT_SHA,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("buildDeployment — limites de ressources (finding H1)", () => {
  it("transmet memory/memswap/cpuperiod/cpuquota à docker.buildImage()", async () => {
    mockFastSuccessfulBuild()

    await buildDeployment({
      siteName: "demo-site",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    })

    expect(mockBuildImage).toHaveBeenCalledTimes(1)

    const [, options] = mockBuildImage.mock.calls[0]

    expect(options).toMatchObject({
      memory: 1024 * 1024 * 1024,
      memswap: 1024 * 1024 * 1024,
      cpuperiod: 100_000,
      cpuquota: 100_000,
    })
  })

  it("transmet un abortSignal distinct à chaque appel", async () => {
    mockFastSuccessfulBuild()

    await buildDeployment({
      siteName: "site-a",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    })

    await buildDeployment({
      siteName: "site-b",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    })

    const [, optionsA] = mockBuildImage.mock.calls[0]
    const [, optionsB] = mockBuildImage.mock.calls[1]

    expect(optionsA.abortSignal).toBeInstanceOf(AbortSignal)
    expect(optionsB.abortSignal).toBeInstanceOf(AbortSignal)
    expect(optionsA.abortSignal).not.toBe(optionsB.abortSignal)
  })
})

describe("buildDeployment — timeout dur (finding H1)", () => {
  it("un build qui ne se termine jamais est réellement annulé après le délai maximal", async () => {
    vi.useFakeTimers()
    mockHangingBuild()

    const promise = buildDeployment({
      siteName: "slow-site",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    })
    /*
     * Empêche Node de signaler un "unhandled rejection" pendant les
     * avancées de fake timers ci-dessous (le rejet réel n'est observé
     * que par l'assertion .rejects plus bas) — artefact de test, pas
     * un vrai unhandled rejection en production.
     */
    promise.catch(() => {})

    // Laisse le clone + la vérification du Dockerfile se résoudre.
    await vi.advanceTimersByTimeAsync(0)

    // Toujours en cours juste avant l'expiration du délai.
    await vi.advanceTimersByTimeAsync(BUILD_TIMEOUT_MS - 1_000)

    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).rejects.toThrow(DeploymentTimeoutError)
  })

  it("nettoie l'image et le répertoire source après un timeout (pas de ressource orpheline)", async () => {
    vi.useFakeTimers()
    mockHangingBuild()

    const promise = buildDeployment({
      siteName: "slow-site-cleanup",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    })
    promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(BUILD_TIMEOUT_MS + 1_000)

    await expect(promise).rejects.toThrow(DeploymentTimeoutError)

    expect(mockGetImage).toHaveBeenCalled()
    expect(mockImageRemove).toHaveBeenCalledWith({ force: true })

    /*
     * Le répertoire source (clone Git) doit lui aussi être nettoyé —
     * jusqu'ici ce mock n'était pas exposé via vi.hoisted() et cette
     * assertion était donc absente : le test prétendait vérifier le
     * nettoyage du répertoire source sans jamais l'observer (finding
     * H1, "tests", revue indépendante du commit 2054172, §5).
     */
    expect(mockFsRm).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
      force: true,
    })
    expect(mockFsRm).toHaveBeenCalledTimes(1)
  })

  it("aucun timer résiduel après un build terminé normalement (pas de build zombie)", async () => {
    vi.useFakeTimers()
    mockFastSuccessfulBuild()

    await buildDeployment({
      siteName: "fast-site",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it("le timeout d'un tenant A n'affecte jamais un build concurrent du tenant B", async () => {
    vi.useFakeTimers()

    /*
     * site-lent (tenant A) : ne se termine jamais tout seul, sauf via
     * SON PROPRE abortSignal. site-rapide (tenant B) : se termine
     * immédiatement. Chaque appel à buildImage() reçoit son PROPRE
     * AbortController (créé localement dans buildDeployment) — la
     * seule façon pour ce test de réussir est que les deux signaux
     * soient réellement indépendants.
     */
    mockBuildImage.mockImplementation((_file, opts) => {
      /*
       * `file.context` est dérivé d'un UUID de déploiement aléatoire
       * (sourcePath), jamais du nom du site — le seul champ des
       * options qui identifie réellement le site est le tag d'image
       * (`opts.t`, construit à partir de siteName dans getImageName()).
       */
      const isSlow = opts.t.includes("tenant-a-site")
      return Promise.resolve({
        __isSlow: isSlow,
        __abortSignal: opts.abortSignal,
      })
    })

    mockFollowProgress.mockImplementation((stream, onFinished) => {
      const s = stream as {
        __isSlow?: boolean
        __abortSignal?: AbortSignal
      }

      if (!s.__isSlow) {
        onFinished(null, [])
        return
      }

      s.__abortSignal?.addEventListener("abort", () => {
        const abortError = new Error("aborted")
        abortError.name = "AbortError"
        onFinished(abortError, null)
      })
    })

    mockImageInspect.mockResolvedValue({ Id: "sha256:fastimage" })

    const slowPromise = buildDeployment({
      siteName: "tenant-a-site",
      repositoryUrl: "https://github.com/acme/tenant-a",
      branch: "main",
    })
    slowPromise.catch(() => {})

    const fastPromise = buildDeployment({
      siteName: "tenant-b-site",
      repositoryUrl: "https://github.com/acme/tenant-b",
      branch: "main",
    })

    await vi.advanceTimersByTimeAsync(0)

    // Le build rapide (tenant B) réussit bien AVANT que le timeout du
    // tenant A n'expire.
    await expect(fastPromise).resolves.toMatchObject({
      siteName: "tenant-b-site",
    })

    // Le build lent (tenant A) expire ensuite via SON PROPRE timeout.
    await vi.advanceTimersByTimeAsync(BUILD_TIMEOUT_MS + 1_000)

    await expect(slowPromise).rejects.toThrow(DeploymentTimeoutError)
  })
})

describe("buildDeployment — erreur Docker réelle (pas un timeout)", () => {
  it("une erreur de build authentique reste un échec normal, jamais un DeploymentTimeoutError", async () => {
    mockBuildImage.mockImplementation(() =>
      Promise.resolve({ __fake: "stream" }),
    )
    mockFollowProgress.mockImplementation((_stream, onFinished) => {
      onFinished(new Error("Dockerfile syntax error"), [
        { error: "Dockerfile syntax error" },
      ])
    })

    await expect(
      buildDeployment({
        siteName: "broken-site",
        repositoryUrl: "https://github.com/acme/app",
        branch: "main",
      }),
    ).rejects.toThrow(/Dockerfile syntax error/)
  })
})

describe("deployDeployment — intégration build + container", () => {
  it("un déploiement réussi enchaîne build puis création du container", async () => {
    mockFastSuccessfulBuild()
    mockCreateDeploymentContainer.mockResolvedValue({
      id: "container-id",
      name: "hosting-site-demo",
      containerName: "hosting-site-demo",
      image: "hosting/demo-site:x",
      containerPort: 8080,
      state: "running",
      running: true,
    })

    const result = await deployDeployment({
      siteName: "demo-site",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
      tenantId: "11111111-1111-4111-8111-111111111111",
    })

    expect(result.container.running).toBe(true)
    expect(mockCreateDeploymentContainer).toHaveBeenCalledTimes(1)
  })
})

/*
 * Finding H1, "timeout incomplet" (revue indépendante du commit
 * 2054172, §2) : le timeout précédent ne couvrait que buildDeployment()
 * — createDeploymentContainer()/cleanupOldImages() (appelés par
 * deployDeployment) n'étaient bornés par AUCUNE limite. Ces tests
 * vérifient le second AbortController dédié à cette phase.
 */
describe("resolveDeploymentTimeouts — dérivation du budget (finding H1)", () => {
  it("sans valeur demandée, retombe sur les budgets par défaut (8 min + 2 min)", () => {
    const result = resolveDeploymentTimeouts(undefined)

    expect(result.buildTimeoutMs).toBe(DEFAULT_BUILD_TIMEOUT_MS)
    expect(result.postBuildTimeoutMs).toBe(
      DEFAULT_POST_BUILD_TIMEOUT_MS,
    )
    expect(result.totalMs).toBe(
      DEFAULT_BUILD_TIMEOUT_MS + DEFAULT_POST_BUILD_TIMEOUT_MS,
    )
  })

  it("une valeur en dessous du plancher est relevée à MIN_DEPLOYMENT_TIMEOUT_MS (défense en profondeur)", () => {
    const result = resolveDeploymentTimeouts(1_000)

    expect(result.totalMs).toBe(MIN_DEPLOYMENT_TIMEOUT_MS)
  })

  it("une valeur au-dessus du plafond est ramenée à MAX_DEPLOYMENT_TIMEOUT_MS (l'Agent ne fait jamais confiance au Panel au-delà)", () => {
    const result = resolveDeploymentTimeouts(
      MAX_DEPLOYMENT_TIMEOUT_MS + 60 * 60 * 1000,
    )

    expect(result.totalMs).toBe(MAX_DEPLOYMENT_TIMEOUT_MS)
  })

  it("buildTimeoutMs + postBuildTimeoutMs vaut toujours exactement totalMs", () => {
    for (const requested of [
      undefined,
      MIN_DEPLOYMENT_TIMEOUT_MS,
      90_000,
      5 * 60 * 1000,
      DEFAULT_BUILD_TIMEOUT_MS + DEFAULT_POST_BUILD_TIMEOUT_MS,
      MAX_DEPLOYMENT_TIMEOUT_MS,
    ]) {
      const result = resolveDeploymentTimeouts(requested)

      expect(
        result.buildTimeoutMs + result.postBuildTimeoutMs,
      ).toBe(result.totalMs)
    }
  })

  it("le build garde toujours une part significative du budget, même sur un budget total proche du plancher", () => {
    const result = resolveDeploymentTimeouts(
      MIN_DEPLOYMENT_TIMEOUT_MS,
    )

    // postBuildTimeoutMs ne mange jamais plus de la moitié du total.
    expect(result.postBuildTimeoutMs).toBeLessThanOrEqual(
      result.buildTimeoutMs,
    )
  })
})

/*
 * Simule un remplacement de container qui ne se termine JAMAIS de
 * lui-même (createDeploymentContainer ne résout que si son
 * abortSignal est déclenché) — même principe que mockHangingBuild(),
 * pour la phase POST-build cette fois.
 */
function mockHangingContainerReplacement() {
  mockCreateDeploymentContainer.mockImplementation(
    ({ abortSignal }: { abortSignal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        abortSignal?.addEventListener("abort", () => {
          const abortError = new Error("aborted")
          abortError.name = "AbortError"
          reject(abortError)
        })
        // Ne résout/rejette jamais spontanément.
      }),
  )
}

describe("deployDeployment — timeout post-build (finding H1)", () => {
  it("un remplacement de container qui ne se termine jamais est réellement annulé après le délai post-build", async () => {
    vi.useFakeTimers()
    mockFastSuccessfulBuild()
    mockHangingContainerReplacement()

    const promise = deployDeployment({
      siteName: "slow-post-build",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
      tenantId: TENANT_ID,
      // Budget total volontairement petit pour ne pas attendre les
      // 10 minutes par défaut dans ce test : buildTimeoutMs=30s,
      // postBuildTimeoutMs=30s (resolveDeploymentTimeouts(60_000)).
      deploymentTimeoutMs: 60_000,
    })
    promise.catch(() => {})

    // Laisse le build (rapide) se terminer complètement.
    await vi.advanceTimersByTimeAsync(0)

    // Toujours en cours juste avant l'expiration du délai post-build.
    await vi.advanceTimersByTimeAsync(29_000)

    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).rejects.toThrow(DeploymentTimeoutError)
  })

  it("le message du timeout post-build est distinct du message du timeout de build", async () => {
    vi.useFakeTimers()
    mockFastSuccessfulBuild()
    mockHangingContainerReplacement()

    const promise = deployDeployment({
      siteName: "slow-post-build-message",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
      tenantId: TENANT_ID,
      deploymentTimeoutMs: 60_000,
    })
    promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(31_000)

    await expect(promise).rejects.toThrow(
      /remplacement du container/,
    )

    /*
     * S'assure explicitement que ce n'est PAS le message de timeout
     * du build qui a fuité ici — les deux phases doivent rester
     * distinguables (exigence explicite de l'utilisateur : "Conserve
     * une distinction claire entre : build timeout ; erreur Docker ;
     * timeout post-build").
     */
    await expect(promise).rejects.not.toThrow(/^Le build a dépassé/)
  })

  it("nettoie l'image buildée après un timeout post-build (pas de ressource orpheline)", async () => {
    vi.useFakeTimers()
    mockFastSuccessfulBuild()
    mockHangingContainerReplacement()

    const promise = deployDeployment({
      siteName: "slow-post-build-cleanup",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
      tenantId: TENANT_ID,
      deploymentTimeoutMs: 60_000,
    })
    promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(31_000)

    await expect(promise).rejects.toThrow(DeploymentTimeoutError)

    const imageNamesRequested = (
      mockGetImage.mock.calls as unknown[][]
    ).map((call) => call[0] as string)
    expect(
      imageNamesRequested.some((name) =>
        name.includes("slow-post-build-cleanup"),
      ),
    ).toBe(true)
    expect(mockImageRemove).toHaveBeenCalled()
  })

  it("aucun timer résiduel après un déploiement complet réussi (pas de déploiement zombie)", async () => {
    vi.useFakeTimers()
    mockFastSuccessfulBuild()
    mockCreateDeploymentContainer.mockResolvedValue({
      id: "container-id",
      name: "hosting-site-ok",
      containerName: "hosting-site-ok",
      image: "hosting/ok-site:x",
      containerPort: 8080,
      state: "running",
      running: true,
    })

    await deployDeployment({
      siteName: "ok-site",
      repositoryUrl: "https://github.com/acme/app",
      branch: "main",
      tenantId: TENANT_ID,
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it("le timeout post-build d'un tenant A n'affecte jamais un remplacement de container concurrent du tenant B", async () => {
    vi.useFakeTimers()
    mockFastSuccessfulBuild()

    mockCreateDeploymentContainer.mockImplementation(
      ({
        siteName,
        abortSignal,
      }: {
        siteName: string
        abortSignal?: AbortSignal
      }) => {
        if (siteName === "tenant-b-site-postbuild") {
          return Promise.resolve({
            id: "container-id",
            name: siteName,
            containerName: siteName,
            image: "hosting/tenant-b-site-postbuild:x",
            containerPort: 8080,
            state: "running",
            running: true,
          })
        }

        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => {
            const abortError = new Error("aborted")
            abortError.name = "AbortError"
            reject(abortError)
          })
        })
      },
    )

    const slowPromise = deployDeployment({
      siteName: "tenant-a-site-postbuild",
      repositoryUrl: "https://github.com/acme/tenant-a",
      branch: "main",
      tenantId: TENANT_ID,
      deploymentTimeoutMs: 60_000,
    })
    slowPromise.catch(() => {})

    const fastPromise = deployDeployment({
      siteName: "tenant-b-site-postbuild",
      repositoryUrl: "https://github.com/acme/tenant-b",
      branch: "main",
      tenantId: TENANT_ID,
    })

    await vi.advanceTimersByTimeAsync(0)

    await expect(fastPromise).resolves.toMatchObject({
      siteName: "tenant-b-site-postbuild",
    })

    await vi.advanceTimersByTimeAsync(31_000)

    await expect(slowPromise).rejects.toThrow(DeploymentTimeoutError)
  })
})
