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
}))

vi.mock("node:fs", () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isFile: () => true }),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}))

import {
  buildDeployment,
  deployDeployment,
  DeploymentTimeoutError,
} from "./deployment.js"

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
