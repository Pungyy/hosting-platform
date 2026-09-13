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
async function getDatabaseContainer(containerName: string) {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({
      name: [`^/${containerName}$`],
    }),
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

  try {
    await pipeline(stdout, createGzip(), createWriteStream(filePath))
  } catch (error) {
    await unlink(filePath).catch(() => {})
    throw error
  }

  const execInfo = await exec.inspect()

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

export async function createBackup(databaseName: string) {
  validateDatabaseName(databaseName)

  const container = await getDatabaseContainer(
    getContainerName(databaseName),
  )

  if (!container) {
    throw new Error(
      `Le container de la base "${databaseName}" est introuvable.`,
    )
  }

  const inspect = await container.inspect()

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
   * Un container "Running" ne veut pas dire que la base cible est déjà
   * utilisable (voir TRANSIENT_ERROR_PATTERN ci-dessus) : sur une base
   * tout juste créée, `pg_dump` peut échouer plusieurs fois de suite
   * avant que l'instance finale de Postgres soit prête. On retente
   * uniquement sur ce type d'erreur précis, jusqu'à ~20s au total.
   */
  const maxAttempts = 20
  const delayMs = 1000

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runPgDumpOnce(container, username, dbName, password, filePath)
      break
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const transient = TRANSIENT_ERROR_PATTERN.test(message)

      if (!transient || attempt === maxAttempts) {
        throw error
      }

      await sleep(delayMs)
    }
  }

  const stats = await stat(filePath)

  return {
    filename,
    sizeBytes: stats.size,
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
