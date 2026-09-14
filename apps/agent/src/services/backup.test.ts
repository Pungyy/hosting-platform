import { EventEmitter } from "node:events"
import path from "node:path"
import { PassThrough } from "node:stream"

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

/*
 * Mocks dockerode/fs pour les tests de timeout/kill/retry (finding M2)
 * — les tests existants ci-dessous (validation) n'atteignent jamais
 * ces mocks (validateDatabaseName() rejette avant tout appel Docker/fs),
 * ils restent donc inchangés et continuent de passer sans dépendre
 * d'eux.
 */
const {
  mockListContainers,
  mockContainerInspect,
  mockContainerExec,
  mockGetContainer,
  mockDemuxStream,
  mockDockerInstance,
} = vi.hoisted(() => {
  const mockContainerInspect = vi.fn()
  const mockContainerExec = vi.fn()
  const mockContainer = {
    inspect: mockContainerInspect,
    exec: mockContainerExec,
  }
  const mockListContainers = vi.fn()
  const mockGetContainer = vi.fn((_id?: string) => mockContainer)
  const mockDemuxStream = vi.fn()

  const mockDockerInstance = {
    listContainers: mockListContainers,
    getContainer: mockGetContainer,
    modem: { demuxStream: mockDemuxStream },
  }

  return {
    mockListContainers,
    mockContainerInspect,
    mockContainerExec,
    mockGetContainer,
    mockDemuxStream,
    mockDockerInstance,
  }
})

vi.mock("dockerode", () => ({
  default: vi.fn().mockImplementation(() => mockDockerInstance),
}))

const { mockCreateWriteStream } = vi.hoisted(() => ({
  mockCreateWriteStream: vi.fn(),
}))

vi.mock("node:fs", () => ({
  createWriteStream: mockCreateWriteStream,
}))

const { mockMkdir, mockStat, mockUnlink, mockRm } = vi.hoisted(() => ({
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockStat: vi.fn().mockResolvedValue({ size: 1234 }),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
  mockRm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  stat: mockStat,
  unlink: mockUnlink,
  rm: mockRm,
}))

import {
  BackupTimeoutError,
  createBackup,
  deleteAllBackups,
  deleteBackupFile,
  getBackupDir,
  getBackupFilePath,
  MIN_BACKUP_TIMEOUT_MS,
  resolveBackupPath,
  validateDatabaseName,
} from "./backup.js"

const VALID_DB_ENV = [
  "POSTGRES_USER=testuser",
  "POSTGRES_DB=testdb",
  "POSTGRES_PASSWORD=testpass",
]

function mockRunningDatabaseContainer() {
  mockListContainers.mockResolvedValue([{ Id: "container-id" }])
  mockContainerInspect.mockResolvedValue({
    State: { Running: true },
    Config: { Env: VALID_DB_ENV },
  })
}

/*
 * Simule un pg_dump qui ne produit jamais aucune sortie et ne se
 * termine jamais de lui-même — reproduit un process bloqué (verrou
 * Postgres, table énorme). Le SECOND exec (la commande `kill`) est
 * intercepté séparément : `-TERM` puis, seulement si le process
 * "résiste" (paramètre killedBySignal), `-KILL` le termine réellement
 * (émission de `end` sur le flux du PREMIER exec, comme le ferait un
 * vrai process dont le stdout se ferme à sa mort).
 */
function mockHangingPgDump(
  killedBySignal: "-TERM" | "-KILL" = "-TERM",
) {
  const killSignalsSent: string[] = []
  const killCmds: string[][] = []
  let pgDumpStream: EventEmitter | null = null
  let dumpKilled = false

  mockContainerExec.mockImplementation(
    (options: { Cmd: string[] }) => {
      if (options.Cmd[0] === "pkill") {
        const signal = options.Cmd[1]
        killSignalsSent.push(signal)
        killCmds.push(options.Cmd)

        if (signal === killedBySignal) {
          dumpKilled = true
          pgDumpStream?.emit("end")
        }

        return {
          start: vi
            .fn()
            .mockResolvedValue(new EventEmitter()),
          inspect: vi.fn(),
        }
      }

      pgDumpStream = new EventEmitter()

      return {
        id: "exec-pgdump",
        start: vi.fn().mockResolvedValue(pgDumpStream),
        inspect: vi.fn().mockImplementation(() =>
          Promise.resolve({
            Running: !dumpKilled,
            ExitCode: dumpKilled ? 143 : null,
            Pid: 4242,
          }),
        ),
      }
    },
  )

  mockDemuxStream.mockImplementation(() => {
    // Ne relaie jamais aucune donnée ni ne termine le flux de
    // lui-même — seul un kill explicite (ci-dessus) y met fin.
  })

  return {
    getKillSignalsSent: () => killSignalsSent,
    getKillCmds: () => killCmds,
  }
}

function mockFastSuccessfulPgDump() {
  mockContainerExec.mockImplementation(() => {
    const stream = new EventEmitter()

    return {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({
        Running: false,
        ExitCode: 0,
        Pid: 1000,
      }),
    }
  })

  mockDemuxStream.mockImplementation(
    (
      execStream: EventEmitter,
      stdout: NodeJS.WritableStream,
    ) => {
      stdout.write("-- dump SQL de test\n")
      queueMicrotask(() => execStream.emit("end"))
    },
  )
}

/*
 * Simule une tentative qui échoue de façon "transitoire" (le pattern
 * que createBackup() retente automatiquement) après un délai donné —
 * pour prouver que le budget total ne peut jamais dépasser le délai
 * global, même si de nombreuses tentatives échouent successivement
 * (finding M2, "budget GLOBAL sur les retries").
 */
function mockSlowTransientFailure(attemptDurationMs: number) {
  let callCount = 0

  mockContainerExec.mockImplementation(() => {
    callCount += 1

    const stream = new EventEmitter()

    return {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({
        Running: false,
        ExitCode: 1,
        Pid: 1,
      }),
    }
  })

  mockDemuxStream.mockImplementation(
    (
      execStream: EventEmitter,
      _stdout: NodeJS.WritableStream,
      stderr: NodeJS.WritableStream,
    ) => {
      setTimeout(() => {
        stderr.write(Buffer.from("Connection refused"))
        execStream.emit("end")
      }, attemptDurationMs)
    },
  )

  return { getCallCount: () => callCount }
}

/*
 * Simule un échec pg_dump RÉEL et définitif (erreur de syntaxe SQL,
 * par exemple) — ne correspond à aucun pattern d'erreur transitoire,
 * donc jamais retenté, et ne doit JAMAIS être classé comme un timeout.
 */
function mockGenuinePgDumpFailure() {
  mockContainerExec.mockImplementation(() => {
    const stream = new EventEmitter()

    return {
      start: vi.fn().mockResolvedValue(stream),
      inspect: vi.fn().mockResolvedValue({
        Running: false,
        ExitCode: 1,
        Pid: 1,
      }),
    }
  })

  mockDemuxStream.mockImplementation(
    (
      execStream: EventEmitter,
      _stdout: NodeJS.WritableStream,
      stderr: NodeJS.WritableStream,
    ) => {
      stderr.write(Buffer.from("pg_dump: erreur de syntaxe SQL"))
      queueMicrotask(() => execStream.emit("end"))
    },
  )
}

const defaultMockContainer = {
  inspect: mockContainerInspect,
  exec: mockContainerExec,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateWriteStream.mockImplementation(() => new PassThrough())
  mockMkdir.mockResolvedValue(undefined)
  mockStat.mockResolvedValue({ size: 1234 })
  mockUnlink.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockGetContainer.mockImplementation(() => defaultMockContainer)
})

afterEach(() => {
  vi.useRealTimers()
})

const VALID_FILENAME = "2026-01-01T000000Z.sql.gz"

/*
 * Ces noms n'existent que dans les tests. Aucun n'est censé jamais
 * atteindre Docker ou le système de fichiers : le but est justement de
 * prouver que validateDatabaseName() les rejette avant tout appel
 * dockerode / fs, sans dépendre d'un daemon Docker démarré.
 */
const MALICIOUS_NAMES = [
  // Injection dans le filtre `name` de dockerode/Docker (interprété
  // comme une regex) : alternation qui sort du préfixe "hosting-db-"
  // pour matcher n'importe quel autre container par son nom exact —
  // ex. le container Postgres partagé d'un autre projet sur la même
  // machine.
  "z$|^/regardscroises-db$",
  // Wildcard générique : élargit le filtre à tout ce qui suit le préfixe.
  ".*",
  // Path traversal visant à faire sortir getBackupDir() du dossier de
  // sauvegardes prévu (critique pour deleteAllBackups(), qui fait un
  // rm recursive+force sur ce chemin).
  "../../etc",
  "..",
  // Autres métacaractères regex/shell qui ne doivent pas être acceptés.
  "hosting-db-victim$",
  "a(b)c",
  "a[b]c",
  "a\\b",
  "a/b",
]

const INVALID_FORMAT_NAMES = [
  "",
  "ab", // trop court (< 3)
  "a".repeat(41), // trop long (> 40)
  "Has-Uppercase",
  "has_underscore",
  "has space",
  "-leading-hyphen",
  "trailing-hyphen-",
  "double--hyphen",
]

const VALID_NAMES = ["abc", "e2e-db-a", "a".repeat(40), "my-database-1"]

describe("validateDatabaseName", () => {
  it("accepte les noms conformes au format des bases créées par la plateforme", () => {
    for (const name of VALID_NAMES) {
      expect(() => validateDatabaseName(name)).not.toThrow()
    }
  })

  it("rejette les noms malveillants visant une injection regex/path traversal", () => {
    for (const name of MALICIOUS_NAMES) {
      expect(() => validateDatabaseName(name)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })

  it("rejette les noms qui ne respectent pas le format attendu", () => {
    for (const name of INVALID_FORMAT_NAMES) {
      expect(() => validateDatabaseName(name)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("getBackupDir", () => {
  it("rejette un nom malveillant avant de construire un chemin", () => {
    for (const name of MALICIOUS_NAMES) {
      expect(() => getBackupDir(name)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })

  it("construit un chemin sous le dossier de sauvegardes pour un nom valide", () => {
    const dir = getBackupDir("my-database-1")
    expect(path.basename(dir)).toBe("my-database-1")
  })
})

describe("resolveBackupPath", () => {
  it("rejette un databaseName malveillant même avec un nom de fichier valide", () => {
    for (const name of MALICIOUS_NAMES) {
      expect(() => resolveBackupPath(name, VALID_FILENAME)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })

  it("retourne null pour un nom de fichier hors du format généré (path traversal filename)", () => {
    expect(resolveBackupPath("valid-name", "../../../etc/passwd")).toBeNull()
  })
})

describe("createBackup", () => {
  it("rejette un databaseName malveillant sans jamais appeler Docker", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(createBackup(name)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("getBackupFilePath", () => {
  it("rejette un databaseName malveillant sans jamais toucher le système de fichiers", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(getBackupFilePath(name, VALID_FILENAME)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("deleteBackupFile", () => {
  it("rejette un databaseName malveillant sans jamais toucher le système de fichiers", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(deleteBackupFile(name, VALID_FILENAME)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("deleteAllBackups", () => {
  it("rejette un databaseName malveillant avant tout appel à rm() recursif", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(deleteAllBackups(name)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("createBackup — chemin nominal (finding M2, non-régression)", () => {
  it("un pg_dump rapide et réussi retourne filename/sizeBytes", async () => {
    mockRunningDatabaseContainer()
    mockFastSuccessfulPgDump()

    const result = await createBackup("fast-db")

    expect(result.filename).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{6}Z\.sql\.gz$/,
    )
    expect(result.sizeBytes).toBe(1234)
    expect(mockUnlink).not.toHaveBeenCalled()
  })

  it("aucun timer résiduel après un backup terminé normalement (pas de backup zombie)", async () => {
    vi.useFakeTimers()
    mockRunningDatabaseContainer()
    mockFastSuccessfulPgDump()

    await createBackup("fast-db-zombie-check")

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("createBackup — timeout réel avec kill du process (finding M2)", () => {
  it("un pg_dump bloqué est réellement tué : PID capturé, SIGTERM envoyé, fichier nettoyé", async () => {
    vi.useFakeTimers()
    mockRunningDatabaseContainer()

    const { getKillSignalsSent, getKillCmds } = mockHangingPgDump(
      "-TERM",
    )

    const promise = createBackup(
      "slow-db",
      MIN_BACKUP_TIMEOUT_MS,
    )
    promise.catch(() => {})

    // Laisse le container/env se résoudre et la première tentative démarrer.
    await vi.advanceTimersByTimeAsync(0)

    // Toujours bloqué juste avant l'expiration du délai global.
    await vi.advanceTimersByTimeAsync(MIN_BACKUP_TIMEOUT_MS - 1_000)

    // Déclenche le timeout global -> envoie SIGTERM.
    await vi.advanceTimersByTimeAsync(2_000)

    // Laisse le délai de grâce SIGTERM -> SIGKILL s'écouler (le
    // process est déjà mort dans ce scénario, aucun SIGKILL attendu).
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(promise).rejects.toThrow(BackupTimeoutError)

    expect(getKillSignalsSent()).toEqual(["-TERM"])

    /*
     * Ciblage par NOM de process (pkill), pas par PID (finding M2,
     * corrigé après vérification empirique : exec.inspect().Pid est
     * un PID host, pas un PID valide depuis l'intérieur du container
     * — un `kill <pid>` lancé par un exec DANS le container ne peut
     * donc jamais matcher ce PID).
     */
    expect(getKillCmds()[0]).toEqual(["pkill", "-TERM", "pg_dump"])

    expect(mockUnlink).toHaveBeenCalled()
  })

  it("escalade en SIGKILL si le process ne répond pas au SIGTERM (délai de grâce dépassé)", async () => {
    vi.useFakeTimers()
    mockRunningDatabaseContainer()

    const { getKillSignalsSent } = mockHangingPgDump("-KILL")

    const promise = createBackup(
      "stubborn-db",
      MIN_BACKUP_TIMEOUT_MS,
    )
    promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MIN_BACKUP_TIMEOUT_MS + 1_000)

    // Le process "résiste" au SIGTERM : seul le SIGKILL (après le
    // délai de grâce) le termine réellement dans ce scénario.
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(promise).rejects.toThrow(BackupTimeoutError)

    expect(getKillSignalsSent()).toEqual(["-TERM", "-KILL"])
  })

  it("le budget total est respecté même si chaque tentative échoue lentement (jamais 20× le délai)", async () => {
    vi.useFakeTimers()
    mockRunningDatabaseContainer()

    /*
     * Chaque tentative "échoue" (erreur transitoire retentée) après
     * 5s. Avec un budget global de MIN_BACKUP_TIMEOUT_MS (30s) et
     * ~6s par cycle (5s + 1s de pause), au plus 5-6 tentatives
     * peuvent avoir lieu — jamais les 20 complètes, qui auraient
     * nécessité ~120s si le budget n'était pas GLOBAL (finding M2,
     * exigence explicite : "il ne faut surtout pas obtenir 20 ×
     * timeout pour un seul backup").
     */
    const { getCallCount } = mockSlowTransientFailure(5_000)

    const promise = createBackup(
      "slow-retry-db",
      MIN_BACKUP_TIMEOUT_MS,
    )
    promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(
      MIN_BACKUP_TIMEOUT_MS + 10_000,
    )

    await expect(promise).rejects.toThrow(BackupTimeoutError)

    expect(getCallCount()).toBeLessThan(10)
  })

  it("le timeout d'un backup n'affecte jamais un backup concurrent d'une autre base", async () => {
    vi.useFakeTimers()

    /*
     * Deux containers DISTINCTS (identité d'objet, pas un ordre
     * d'exécution supposé) pour éviter toute ambiguïté d'interclassement
     * entre les deux appels concurrents — chacun avec son PROPRE
     * AbortController (créé localement dans createBackup). La seule
     * façon pour ce test de réussir est que les deux budgets soient
     * réellement indépendants, comme pour l'isolation par tenant de H1.
     */
    const killSignalsSent: string[] = []
    let slowPgDumpStream: EventEmitter | null = null
    let slowDumpKilled = false

    const slowContainer = {
      inspect: vi.fn().mockResolvedValue({
        State: { Running: true },
        Config: { Env: VALID_DB_ENV },
      }),
      exec: vi.fn().mockImplementation(
        (options: { Cmd: string[] }) => {
          if (options.Cmd[0] === "pkill") {
            killSignalsSent.push(options.Cmd[1])
            slowDumpKilled = true
            slowPgDumpStream?.emit("end")

            return {
              start: vi
                .fn()
                .mockResolvedValue(new EventEmitter()),
              inspect: vi.fn(),
            }
          }

          slowPgDumpStream = new EventEmitter()

          return {
            start: vi
              .fn()
              .mockResolvedValue(slowPgDumpStream),
            inspect: vi.fn().mockImplementation(() =>
              Promise.resolve({
                Running: !slowDumpKilled,
                ExitCode: slowDumpKilled ? 143 : null,
                Pid: 5555,
              }),
            ),
          }
        },
      ),
    }

    const fastContainer = {
      inspect: vi.fn().mockResolvedValue({
        State: { Running: true },
        Config: { Env: VALID_DB_ENV },
      }),
      exec: vi.fn().mockImplementation(() => {
        const stream = new EventEmitter()

        return {
          start: vi.fn().mockResolvedValue(stream),
          inspect: vi.fn().mockResolvedValue({
            Running: false,
            ExitCode: 0,
            Pid: 6666,
          }),
        }
      }),
    }

    mockListContainers.mockImplementation(
      async (options: { filters: string }) => {
        const parsed = JSON.parse(options.filters)
        const pattern = parsed.name[0] as string

        return pattern.includes("slow-isolated-db")
          ? [{ Id: "slow-container" }]
          : [{ Id: "fast-container" }]
      },
    )

    mockGetContainer.mockImplementation((id?: string) =>
      id === "slow-container" ? slowContainer : fastContainer,
    )

    mockDemuxStream.mockImplementation(
      (
        execStream: EventEmitter,
        stdout: NodeJS.WritableStream,
      ) => {
        // Le container lent ne produit jamais de sortie et ne
        // termine jamais son flux de lui-même (bloqué) ; le rapide en
        // produit immédiatement — distingué par IDENTITÉ D'OBJET du
        // stream, jamais par un ordre d'exécution supposé.
        if (execStream === slowPgDumpStream) {
          return
        }

        stdout.write("-- dump SQL rapide\n")
        queueMicrotask(() => execStream.emit("end"))
      },
    )

    const slowPromise = createBackup(
      "slow-isolated-db",
      MIN_BACKUP_TIMEOUT_MS,
    )
    slowPromise.catch(() => {})

    const fastPromise = createBackup("fast-isolated-db")

    await vi.advanceTimersByTimeAsync(0)

    // Le backup rapide (l'autre base) réussit bien AVANT que le
    // timeout du backup lent n'expire.
    await expect(fastPromise).resolves.toMatchObject({
      sizeBytes: 1234,
    })

    // Le backup lent expire ensuite via SON PROPRE timeout, sans
    // rapport avec le succès déjà obtenu par le second.
    await vi.advanceTimersByTimeAsync(MIN_BACKUP_TIMEOUT_MS + 1_000)
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(slowPromise).rejects.toThrow(BackupTimeoutError)
    expect(killSignalsSent).toContain("-TERM")
  })
})

describe("createBackup — distinction timeout / erreur pg_dump réelle (finding M2)", () => {
  it("une erreur pg_dump authentique (non transitoire) reste un échec normal, jamais un BackupTimeoutError", async () => {
    mockRunningDatabaseContainer()
    mockGenuinePgDumpFailure()

    await expect(createBackup("broken-db")).rejects.toThrow(
      /erreur de syntaxe SQL/,
    )

    // Le fichier partiel doit être nettoyé même pour un échec normal.
    expect(mockUnlink).toHaveBeenCalled()
  })

  it("une erreur pg_dump authentique n'est jamais un BackupTimeoutError", async () => {
    mockRunningDatabaseContainer()
    mockGenuinePgDumpFailure()

    await expect(createBackup("broken-db-2")).rejects.not.toThrow(
      BackupTimeoutError,
    )
  })
})
