import { createWriteStream } from "node:fs"
import { mkdir, rm, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { PassThrough, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"

import Docker from "dockerode"

const docker = new Docker()

const DB_PREFIX = "hosting-db-"

/*
 * Même convention ad hoc que TRAEFIK_CONFIG_PATH dans services/traefik.ts :
 * pas de concept de « dossier data » partagé côté Agent, donc un
 * chemin overridable par env plutôt qu'une nouvelle abstraction.
 */
const BACKUPS_DIR =
  process.env.BACKUPS_DIR ??
  path.resolve(process.cwd(), "data/backups")

const FILENAME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{6}Z\.sql\.gz$/

const DATABASE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/*
 * Duplique volontairement database.ts:validateDatabaseName() — même
 * raison que getDatabaseContainer ci-dessous : ce fichier reste
 * autonome plutôt que de coupler deux modules déjà vérifiés
 * séparément.
 *
 * `databaseName` arrive ici directement depuis le paramètre d'URL de
 * l'Agent (index.ts, ex. POST /databases/:name/backups), donc AVANT
 * toute validation de forme. Sans ce contrôle : (1) getContainerName()
 * nourrit un filtre `name` de dockerode/Docker qui est interprété comme
 * une regex — un nom comme ".*" ou "x$|hosting-db-victime" peut faire
 * matcher le container d'un autre tenant ; (2) getBackupDir() nourrit
 * directement path.join() — un nom comme "../../etc" peut faire sortir
 * le chemin résolu du dossier de sauvegardes prévu (grave en
 * particulier pour deleteAllBackups(), qui fait un rm recursive+force
 * sur ce chemin). Appelée en tout premier dans chaque fonction exportée
 * qui reçoit un `databaseName` brut, avant toute autre utilisation.
 */
export function validateDatabaseName(name: string) {
  if (
    !DATABASE_NAME_PATTERN.test(name) ||
    name.length < 3 ||
    name.length > 40
  ) {
    throw new Error("Nom de base de données invalide.")
  }
}

function getContainerName(name: string) {
  return `${DB_PREFIX}${name}`
}

/*
 * Duplique volontairement l'équivalent de services/database.ts (non
 * exporté) — même logique déjà appliquée à docker.ts vs database.ts :
 * chaque fichier reste autonome plutôt que de coupler des modules déjà
 * vérifiés séparément.
 */
async function getDatabaseContainer(
  containerName: string,
  abortSignal?: AbortSignal,
) {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({
      name: [`^/${containerName}$`],
    }),
    abortSignal,
  })

  if (containers.length === 0) {
    return null
  }

  return docker.getContainer(containers[0].Id)
}

export function getBackupDir(databaseName: string) {
  validateDatabaseName(databaseName)
  return path.join(BACKUPS_DIR, databaseName)
}

function parseContainerEnv(env: string[] | undefined) {
  const map: Record<string, string> = {}

  for (const entry of env ?? []) {
    const index = entry.indexOf("=")

    if (index === -1) {
      continue
    }

    map[entry.slice(0, index)] = entry.slice(index + 1)
  }

  return map
}

function generateFilename() {
  const [datePart, timePart] = new Date().toISOString().split("T")
  const time = timePart.replace(/[:.]/g, "").slice(0, 6)

  return `${datePart}T${time}Z.sql.gz`
}

/*
 * Vérifie que `filename` est un nom généré par generateFilename() (pas
 * une valeur arbitraire fournie par l'appelant) et que le chemin résolu
 * reste bien dans le dossier de sauvegardes de cette base — défense en
 * profondeur contre un path traversal, même si le nom est déjà généré
 * côté serveur.
 */
export function resolveBackupPath(
  databaseName: string,
  filename: string,
) {
  if (!FILENAME_PATTERN.test(filename)) {
    return null
  }

  const dir = getBackupDir(databaseName)
  const resolved = path.resolve(dir, filename)

  if (
    resolved !== path.join(dir, filename) ||
    !resolved.startsWith(path.resolve(dir) + path.sep)
  ) {
    return null
  }

  return resolved
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/*
 * Version annulable de sleep() : se réveille immédiatement si le
 * signal se déclenche pendant l'attente, plutôt que de laisser la
 * boucle de retry gaspiller du temps sur une pause inutile une fois le
 * délai global déjà dépassé (finding M2, "budget global").
 */
function sleepAbortable(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms)

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(handle)
        resolve()
      },
      { once: true },
    )
  })
}

/*
 * Levée quand createBackup() est annulé pour dépassement du délai de
 * sécurité (finding M2) — distincte d'une erreur pg_dump authentique
 * pour que l'appelant (controllers/backups.ts) puisse répondre avec un
 * signal explicite (`timeout: true`), même mécanisme que
 * DeploymentTimeoutError (finding H1, services/deployment.ts).
 */
export class BackupTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BackupTimeoutError"
  }
}

/*
 * Budget de temps de la sauvegarde (finding M2, "timeout pg_dump").
 *
 * Le PANEL est l'unique source de vérité sur la durée totale
 * autorisée pour l'ENSEMBLE de l'opération (toutes les tentatives de
 * retry comprises), et la transmet explicitement à chaque appel
 * (`backupTimeoutMs`, voir controllers/backups.ts) — même
 * architecture que AGENT_DEPLOYMENT_TIMEOUT_MS (finding H1). Le
 * timeout HTTP existant côté Panel (10 min, voir
 * apps/panel/src/lib/agent/client.ts:createAgentDatabaseBackup) DEVIENT
 * la source de cette valeur (AGENT_BACKUP_TIMEOUT_MS = 9 min + 1 min de
 * marge réseau = 10 min, valeur observable inchangée) plutôt qu'un
 * second nombre indépendant.
 *
 * L'Agent ne fait jamais une confiance illimitée à cette valeur :
 * DEFAULT_BACKUP_TIMEOUT_MS sert de repli si le champ est absent
 * (rétrocompat), et MIN/MAX_BACKUP_TIMEOUT_MS bornent ce qui est
 * accepté quelle que soit la valeur reçue (défense en profondeur).
 */
export const DEFAULT_BACKUP_TIMEOUT_MS = 9 * 60 * 1000
export const MIN_BACKUP_TIMEOUT_MS = 30 * 1000
export const MAX_BACKUP_TIMEOUT_MS = 15 * 60 * 1000

export function resolveBackupTimeoutMs(
  requestedMs?: number,
): number {
  const requested = requestedMs ?? DEFAULT_BACKUP_TIMEOUT_MS

  return Math.min(
    Math.max(requested, MIN_BACKUP_TIMEOUT_MS),
    MAX_BACKUP_TIMEOUT_MS,
  )
}

/*
 * Délai de grâce entre un SIGTERM et un SIGKILL lors de l'arrêt forcé
 * de pg_dump — même logique qu'un `docker stop` (arrêt propre d'abord,
 * arrêt brutal seulement si le process ne répond pas).
 */
const KILL_GRACE_MS = 5_000

/*
 * `docker exec` n'a pas de primitive d'annulation côté daemon
 * (contrairement à docker.buildImage(), vérifié pour H1 : annuler un
 * abortSignal transmis à buildImage() coupe la connexion HTTP que le
 * daemon suit pendant tout le build ; `docker exec` n'a pas
 * d'équivalent — annuler notre lecture du flux d'attach n'a AUCUNE
 * garantie de tuer le process qui tourne à l'intérieur du container).
 * Le seul mécanisme fiable est d'envoyer un signal explicite au process
 * pg_dump, via un SECOND exec dans le MÊME container.
 *
 * DEUX pièges vérifiés empiriquement avant cette implémentation
 * (jamais assumés) :
 *
 * 1. exec.inspect().Pid N'EST PAS le PID vu depuis l'intérieur du
 *    container — c'est le PID vu depuis le namespace de l'HÔTE (vérifié
 *    par comparaison directe avec `ps aux` exécuté dans le même
 *    container : deux numéros totalement différents). Un `kill <pid>`
 *    lancé par un exec DANS le container (donc dans le namespace PID du
 *    container) ne peut donc jamais cibler ce PID — il échoue
 *    silencieusement ("No such process"). On cible donc le process par
 *    NOM (`pkill pg_dump`), qui opère entièrement à l'intérieur du
 *    namespace PID du container, sans jamais avoir besoin de traduire
 *    un PID entre namespaces.
 *
 * 2. exec.start() SANS `Detach: true` fait attendre par le daemon
 *    Docker un flux de sortie que personne ne lit ici (AttachStdout/
 *    AttachStderr à `false` seulement à la CRÉATION de l'exec ne suffit
 *    pas) — la commande de kill elle-même ne se termine alors jamais
 *    (vérifié : sans `Detach: true`, le process cible restait "Running"
 *    indéfiniment car le kill lui-même ne s'exécutait jamais). `Detach:
 *    true` est donc obligatoire ici.
 *
 * `pkill pg_dump` reste strictement scopé au container de CETTE base
 * (jamais un autre container/tenant) puisque `container` provient déjà
 * de getDatabaseContainer(databaseName) validé par l'appelant — et ne
 * peut, par construction du verrou Panel (une seule sauvegarde
 * 'creating' à la fois par base), jamais matcher qu'un unique pg_dump
 * légitime à l'intérieur de ce même container.
 */
async function sendSignalToProcess(
  container: Docker.Container,
  signal: "TERM" | "KILL",
) {
  const killExec = await container.exec({
    Cmd: ["pkill", `-${signal}`, "pg_dump"],
    AttachStdout: false,
    AttachStderr: false,
  })

  await killExec.start({ Detach: true })
}

async function killPgDumpProcess(
  container: Docker.Container,
  exec: Docker.Exec,
) {
  const info = await exec.inspect().catch(() => null)

  if (!info?.Running) {
    return
  }

  await sendSignalToProcess(container, "TERM")

  await sleep(KILL_GRACE_MS)

  const stillRunning = await exec.inspect().catch(() => null)

  if (stillRunning?.Running) {
    await sendSignalToProcess(container, "KILL")
  }
}

/*
 * Erreurs typiques d'un Postgres pas encore complètement démarré :
 * l'entrypoint officiel fait tourner une instance temporaire pour les
 * scripts d'init (accepte déjà des connexions, mais la base cible et
 * son utilisateur ne sont pas encore créés), l'arrête, puis démarre
 * l'instance finale — plusieurs secondes de fenêtres transitoires où
 * `pg_dump` échoue pour des raisons purement temporelles, pas réelles.
 */
const TRANSIENT_ERROR_PATTERN =
  /No such file or directory|does not exist|starting up|shutting down|Connection refused/i

async function runPgDumpOnce(
  container: Docker.Container,
  username: string,
  dbName: string,
  password: string,
  filePath: string,
  abortSignal: AbortSignal,
) {
  const exec = await container.exec({
    Cmd: ["pg_dump", "-U", username, "-d", dbName, "--no-owner"],
    Env: [`PGPASSWORD=${password}`],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  })

  const execStream = await exec.start({ hijack: true, stdin: false })

  const stdout = new PassThrough()
  const stderrChunks: Buffer[] = []
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk)
      callback()
    },
  })

  docker.modem.demuxStream(execStream, stdout, stderr)

  /*
   * `demuxStream` ne relaie que les événements `data` (voir
   * docker-modem/lib/modem.js) — il ne termine jamais lui-même les
   * streams stdout/stderr. Sans ça, le `pipeline` ci-dessous attend
   * indéfiniment un `end()` qui ne vient jamais, même une fois
   * `pg_dump` terminé côté container.
   */
  execStream.on("end", () => {
    stdout.end()
    stderr.end()
  })

  /*
   * Finding M2 ("timeout pg_dump") : si le délai global expire PENDANT
   * que ce pg_dump tourne, on tue réellement le process (voir
   * killPgDumpProcess ci-dessus) — jamais un simple abandon de notre
   * lecture du flux qui laisserait pg_dump continuer en arrière-plan.
   * `timedOut` est la source de vérité locale (le signal peut aussi
   * s'être déclenché entre deux tentatives, sans jamais atteindre ce
   * gestionnaire) : voir les deux vérifications explicites plus bas.
   */
  let timedOut = false

  const onAbort = () => {
    timedOut = true

    killPgDumpProcess(container, exec).catch((error) => {
      console.error(
        `[backup] Impossible de tuer le process pg_dump (exec ${exec.id}) :`,
        error,
      )
    })
  }

  if (abortSignal.aborted) {
    onAbort()
  } else {
    abortSignal.addEventListener("abort", onAbort, { once: true })
  }

  try {
    await pipeline(stdout, createGzip(), createWriteStream(filePath))
  } catch (error) {
    await unlink(filePath).catch(() => {})

    if (timedOut) {
      throw new BackupTimeoutError(
        "pg_dump a été annulé pour dépassement du délai de sécurité.",
      )
    }

    throw error
  } finally {
    abortSignal.removeEventListener("abort", onAbort)
  }

  const execInfo = await exec.inspect()

  /*
   * Vérifié APRÈS la lecture de exitCode (un process tué par SIGTERM
   * peut terminer son flux proprement avant que le pipeline ne rejette
   * — voir le commentaire de killPgDumpProcess) : seul `timedOut`
   * indique de façon certaine que C'EST NOUS qui avons interrompu
   * l'opération, jamais un échec pg_dump normal.
   */
  if (timedOut) {
    await unlink(filePath).catch(() => {})

    throw new BackupTimeoutError(
      "pg_dump a été annulé pour dépassement du délai de sécurité.",
    )
  }

  if (execInfo.ExitCode !== 0) {
    await unlink(filePath).catch(() => {})

    const stderrText = Buffer.concat(stderrChunks)
      .toString("utf8")
      .slice(0, 500)

    throw new Error(
      `pg_dump a échoué${stderrText ? ` : ${stderrText}` : "."}`,
    )
  }
}

export async function createBackup(
  databaseName: string,
  backupTimeoutMs?: number,
) {
  validateDatabaseName(databaseName)

  const timeoutMs = resolveBackupTimeoutMs(backupTimeoutMs)

  /*
   * Finding M2 ("timeout pg_dump") : UN SEUL AbortController pour
   * l'INTÉGRALITÉ de l'opération, tentatives de retry comprises —
   * jamais un budget par tentative, qui multiplierait le délai réel
   * par jusqu'à maxAttempts (ici 20×). Le signal, une fois déclenché,
   * est la seule source de vérité pour distinguer une annulation par
   * timeout d'une erreur pg_dump authentique (voir runPgDumpOnce).
   */
  const controller = new AbortController()

  const timeoutHandle = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const container = await getDatabaseContainer(
      getContainerName(databaseName),
      controller.signal,
    )

    if (!container) {
      throw new Error(
        `Le container de la base "${databaseName}" est introuvable.`,
      )
    }

    const inspect = await container.inspect({
      abortSignal: controller.signal,
    })

    if (!inspect.State?.Running) {
      throw new Error(
        "La base doit être en ligne pour être sauvegardée.",
      )
    }

    const env = parseContainerEnv(inspect.Config?.Env)
    const username = env.POSTGRES_USER
    const dbName = env.POSTGRES_DB
    const password = env.POSTGRES_PASSWORD

    if (!username || !dbName || !password) {
      throw new Error(
        "Configuration de la base introuvable sur le container.",
      )
    }

    const dir = getBackupDir(databaseName)
    await mkdir(dir, { recursive: true })

    const filename = generateFilename()
    const filePath = path.join(dir, filename)

    /*
     * Un container "Running" ne veut pas dire que la base cible est
     * déjà utilisable (voir TRANSIENT_ERROR_PATTERN ci-dessus) : sur
     * une base tout juste créée, `pg_dump` peut échouer plusieurs fois
     * de suite avant que l'instance finale de Postgres soit prête. On
     * retente uniquement sur ce type d'erreur précis — mais TOUJOURS
     * dans la limite du budget global ci-dessus, jamais au-delà.
     */
    const maxAttempts = 20
    const delayMs = 1000

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (controller.signal.aborted) {
        throw new BackupTimeoutError(
          `pg_dump a dépassé le délai maximal de ${timeoutMs / 60_000} minutes et a été annulé.`,
        )
      }

      try {
        await runPgDumpOnce(
          container,
          username,
          dbName,
          password,
          filePath,
          controller.signal,
        )
        break
      } catch (error) {
        if (
          error instanceof BackupTimeoutError ||
          controller.signal.aborted
        ) {
          throw new BackupTimeoutError(
            `pg_dump a dépassé le délai maximal de ${timeoutMs / 60_000} minutes et a été annulé.`,
          )
        }

        const message =
          error instanceof Error ? error.message : String(error)
        const transient = TRANSIENT_ERROR_PATTERN.test(message)

        if (!transient || attempt === maxAttempts) {
          throw error
        }

        await sleepAbortable(delayMs, controller.signal)
      }
    }

    const stats = await stat(filePath)

    return {
      filename,
      sizeBytes: stats.size,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export async function getBackupFilePath(
  databaseName: string,
  filename: string,
) {
  const filePath = resolveBackupPath(databaseName, filename)

  if (!filePath) {
    return null
  }

  try {
    await stat(filePath)
  } catch {
    return null
  }

  return filePath
}

export async function deleteBackupFile(
  databaseName: string,
  filename: string,
) {
  const filePath = resolveBackupPath(databaseName, filename)

  if (!filePath) {
    throw new Error("Nom de fichier de sauvegarde invalide.")
  }

  await unlink(filePath).catch(() => {})

  return { filename, deleted: true }
}

export async function deleteAllBackups(databaseName: string) {
  await rm(getBackupDir(databaseName), {
    recursive: true,
    force: true,
  })
}
