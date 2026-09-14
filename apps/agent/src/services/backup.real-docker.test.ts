import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { PassThrough, Writable } from "node:stream"

import Docker from "dockerode"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/*
 * Test d'intégration RÉEL contre un daemon Docker local — jamais
 * exécuté par défaut (opt-in explicite via AGENT_REAL_DOCKER_TESTS=1),
 * même principe que deployment.real-docker.test.ts (finding H1).
 *
 * Contrairement à backup.test.ts (dockerode entièrement mocké), ce
 * fichier NE mocke PAS dockerode : createBackup() y exécute un VRAI
 * `pg_dump` contre un VRAI container Postgres. Le blocage n'est pas
 * simulé par un simple sleep : une session Postgres séparée pose un
 * VRAI verrou ACCESS EXCLUSIVE sur la table à sauvegarder — pg_dump
 * s'y heurte réellement, exactement comme dans le scénario décrit par
 * l'audit (Q10 : "que se passe-t-il si pg_dump reste bloqué ?").
 *
 * Finding M2 ("vrai arrêt du process pg_dump") : les autres tests
 * (backup.test.ts) prouvent seulement que le code TypeScript de
 * l'Agent réagit correctement à un exec/exec.inspect() simulé. Aucun
 * d'eux ne prouve que le PROCESS pg_dump réel, à l'intérieur d'un vrai
 * container, est effectivement tué. Ce test-ci le vérifie
 * empiriquement : après le timeout, on interroge le container lui-même
 * (`ps aux`) pour confirmer qu'aucun process pg_dump ne survit.
 */
const REAL_DOCKER_ENABLED =
  process.env.AGENT_REAL_DOCKER_TESTS === "1"

const DB_SHORT_NAME = "real-docker-backup-test"
const CONTAINER_NAME = `hosting-db-${DB_SHORT_NAME}`
const DB_USER = "testuser"
const DB_NAME = "testdb"
const DB_PASSWORD = "testpass123"
const TEST_LABEL_KEY = "hosting.platform.test"
const TEST_LABEL_VALUE = "m2-real-docker-integration"

/*
 * Exécute une commande via `docker exec` et récupère sa sortie
 * complète (stdout) une fois terminée — utilisé uniquement pour la
 * préparation/vérification du test (psql de contrôle), jamais pour
 * l'opération réellement mesurée (createBackup() lui-même).
 */
async function runExecAndCollectStdout(
  container: Docker.Container,
  cmd: string[],
  env: string[] = [],
): Promise<{ stdout: string; exitCode: number | null }> {
  const docker = new Docker()

  const exec = await container.exec({
    Cmd: cmd,
    Env: env,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  })

  const execStream = await exec.start({ hijack: true, stdin: false })

  const stdoutChunks: Buffer[] = []
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk)
      callback()
    },
  })
  const stderr = new PassThrough()
  stderr.resume()

  docker.modem.demuxStream(execStream, stdout, stderr)

  await new Promise<void>((resolve) => {
    execStream.on("end", resolve)
  })

  const info = await exec.inspect()

  return {
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    exitCode: info.ExitCode,
  }
}

async function waitUntilAccessExclusiveLockHeld(
  container: Docker.Container,
  timeoutMs = 15_000,
) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const { stdout } = await runExecAndCollectStdout(
      container,
      [
        "psql",
        "-U",
        DB_USER,
        "-d",
        DB_NAME,
        "-t",
        "-c",
        "SELECT count(*) FROM pg_locks WHERE relation = 'locked_table'::regclass AND mode = 'AccessExclusiveLock' AND granted = true;",
      ],
      [`PGPASSWORD=${DB_PASSWORD}`],
    )

    if (parseInt(stdout.trim(), 10) >= 1) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  throw new Error(
    "Timeout : le verrou ACCESS EXCLUSIVE de préparation du test n'a jamais été détecté comme posé.",
  )
}

/*
 * `pg_isready` seul est TROMPEUR ici (vérifié empiriquement) : l'image
 * officielle postgres démarre une instance TEMPORAIRE pour exécuter
 * les scripts d'init (qui répond déjà "accepting connections" alors
 * que la base cible n'existe pas encore), puis l'arrête et démarre
 * l'instance FINALE — même fenêtre transitoire que documentée dans
 * createBackup() lui-même (TRANSIENT_ERROR_PATTERN). Il faut donc
 * réellement INTERROGER la base cible, pas seulement le socket.
 */
async function waitForPostgresReady(
  container: Docker.Container,
  timeoutMs = 60_000,
) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const { exitCode } = await runExecAndCollectStdout(
      container,
      ["psql", "-U", DB_USER, "-d", DB_NAME, "-c", "SELECT 1;"],
      [`PGPASSWORD=${DB_PASSWORD}`],
    ).catch(() => ({ exitCode: 1, stdout: "" }))

    if (exitCode === 0) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    "Timeout : la base de test n'a jamais été réellement interrogeable dans le container de test.",
  )
}

describe.skipIf(!REAL_DOCKER_ENABLED)(
  "createBackup — intégration RÉELLE contre un daemon Docker local (finding M2, opt-in)",
  () => {
    const docker = new Docker()
    let backupsDir: string
    let originalBackupsDirEnv: string | undefined

    beforeAll(async () => {
      originalBackupsDirEnv = process.env.BACKUPS_DIR

      backupsDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "hosting-real-docker-backups-"),
      )
      process.env.BACKUPS_DIR = backupsDir

      // Nettoyage préalable si un précédent run a laissé un container.
      await docker
        .getContainer(CONTAINER_NAME)
        .remove({ force: true })
        .catch(() => {})

      const container = await docker.createContainer({
        name: CONTAINER_NAME,
        Image: "postgres:16-alpine",
        Env: [
          `POSTGRES_USER=${DB_USER}`,
          `POSTGRES_DB=${DB_NAME}`,
          `POSTGRES_PASSWORD=${DB_PASSWORD}`,
        ],
        Labels: {
          [TEST_LABEL_KEY]: TEST_LABEL_VALUE,
        },
        HostConfig: {
          AutoRemove: false,
        },
      })

      await container.start()

      await waitForPostgresReady(container)

      await runExecAndCollectStdout(
        container,
        [
          "psql",
          "-U",
          DB_USER,
          "-d",
          DB_NAME,
          "-c",
          "CREATE TABLE locked_table (id int);",
        ],
        [`PGPASSWORD=${DB_PASSWORD}`],
      )

      /*
       * Pose un VRAI verrou ACCESS EXCLUSIVE et le maintient pendant
       * 120s (largement au-delà de la fenêtre du test) via un exec
       * distinct, laissé tourner en arrière-plan — pg_dump, lui, aura
       * seulement besoin d'un verrou ACCESS SHARE sur cette même table
       * pour la sauvegarder, qui entre directement en conflit.
       */
      const lockExec = await container.exec({
        Cmd: [
          "psql",
          "-U",
          DB_USER,
          "-d",
          DB_NAME,
          "-c",
          "BEGIN; LOCK TABLE locked_table IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120);",
        ],
        Env: [`PGPASSWORD=${DB_PASSWORD}`],
        AttachStdout: true,
        AttachStderr: true,
      })

      const lockStream = await lockExec.start({
        hijack: true,
        stdin: false,
      })

      // Laisse tourner en arrière-plan sans jamais attendre sa fin —
      // c'est le VERROU qui nous intéresse, pas la sortie de ce psql.
      lockStream.resume()

      await waitUntilAccessExclusiveLockHeld(container)
    }, 60_000)

    afterAll(async () => {
      await docker
        .getContainer(CONTAINER_NAME)
        .remove({ force: true })
        .catch(() => {})

      if (backupsDir) {
        await fs
          .rm(backupsDir, { recursive: true, force: true })
          .catch(() => {})
      }

      process.env.BACKUPS_DIR = originalBackupsDirEnv
    }, 30_000)

    it(
      "un pg_dump réellement bloqué par un verrou Postgres est tué : aucun process pg_dump ne survit après le timeout",
      async () => {
        const {
          createBackup,
          BackupTimeoutError,
          MIN_BACKUP_TIMEOUT_MS,
        } = await import("./backup.js")

        const startedAt = Date.now()

        let caughtError: unknown = null

        try {
          await createBackup(
            DB_SHORT_NAME,
            MIN_BACKUP_TIMEOUT_MS,
          )
        } catch (error) {
          caughtError = error
        }

        const elapsedMs = Date.now() - startedAt

        expect(caughtError).toBeInstanceOf(BackupTimeoutError)

        /*
         * Preuve n°1 : l'appel a bien été interrompu près du délai
         * demandé (~30s), pas après les 120s du verrou — ce qui
         * indiquerait que pg_dump a fini d'attendre naturellement
         * plutôt que d'avoir été activement annulé.
         */
        expect(elapsedMs).toBeLessThan(90_000)

        /*
         * Preuve n°2 (la question réellement posée) : quelques
         * secondes après l'annulation, AUCUN process pg_dump ne doit
         * plus exister DANS le container — sinon il aurait survécu à
         * l'annulation, consommant des ressources jusqu'à obtenir
         * enfin le verrou (jusqu'à 120s plus tard).
         */
        await new Promise((resolve) => setTimeout(resolve, 3_000))

        const container = docker.getContainer(CONTAINER_NAME)

        const { stdout: psOutput } = await runExecAndCollectStdout(
          container,
          ["ps", "aux"],
        )

        expect(psOutput).not.toContain("pg_dump")
      },
      90_000,
    )
  },
)
