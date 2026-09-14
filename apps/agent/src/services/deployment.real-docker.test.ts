import { promises as fs } from "node:fs"
import path from "node:path"

import Docker from "dockerode"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/*
 * Test d'intégration RÉEL contre un daemon Docker local — jamais
 * exécuté par défaut (opt-in explicite via AGENT_REAL_DOCKER_TESTS=1).
 *
 * Contrairement à deployment.test.ts (dockerode entièrement mocké),
 * ce fichier NE mocke PAS dockerode : buildDeployment() y utilise le
 * vrai client Docker de ce process, contre le vrai daemon de la
 * machine. Seul cloneRepository (dépendance réseau Git, hors sujet
 * ici) est remplacé par un Dockerfile écrit localement.
 *
 * Finding H1, "vrai arrêt du build Docker" (revue indépendante du
 * commit 2054172, §4) : tous les autres tests (docker.test.ts,
 * deployment.test.ts) prouvent seulement que le code TypeScript de
 * l'Agent réagit correctement à un abort simulé. Aucun d'eux ne prouve
 * que le DAEMON Docker arrête réellement le process de l'étape RUN en
 * cours quand la connexion HTTP Agent -> daemon est coupée. Ce test-ci
 * le vérifie empiriquement : un vrai `RUN sleep 45`, un abort déclenché
 * après quelques secondes, puis une vérification qu'aucun container ne
 * continue à exécuter ce sleep en arrière-plan après l'abort.
 */
const REAL_DOCKER_ENABLED =
  process.env.AGENT_REAL_DOCKER_TESTS === "1"

const { mockCloneRepository } = vi.hoisted(() => ({
  mockCloneRepository: vi.fn(),
}))

vi.mock("./git.js", () => ({
  cloneRepository: mockCloneRepository,
}))

const TEST_LABEL = "hosting.platform.test=h1-real-docker-integration"
const SLEEP_SECONDS = 45
/*
 * Doit laisser le temps à Docker de dépasser l'étape FROM (vérif du
 * digest distant même avec pull:true et l'image déjà en cache local)
 * ET d'entrer réellement dans l'étape RUN sleep avant l'abort — sinon
 * ce test ne prouverait qu'une annulation pré-RUN, pas l'arrêt d'un
 * process RUN effectivement en cours. Mesuré empiriquement dans CET
 * environnement (Docker Desktop / WSL2) : 4 s n'atteint même pas la
 * fin de l'étape FROM ; 10 s atteint seulement le début de l'étape
 * LABEL (chaque étape du builder classique crée/commit/supprime un
 * container, ce qui a un coût mesurable même sans exécuter de vraie
 * commande).
 */
const BUILD_TIMEOUT_MS = 20_000

describe.skipIf(!REAL_DOCKER_ENABLED)(
  "buildDeployment — intégration RÉELLE contre un daemon Docker local (finding H1, opt-in)",
  () => {
    const docker = new Docker()

    beforeAll(() => {
      /*
       * buildDeployment() calcule lui-même son sourcePath
       * (DEPLOYMENT_ROOT/<deploymentId>, un UUID généré à chaque
       * appel) et le transmet à cloneRepository() via son argument
       * `destination` — c'est CE répertoire, pas un chemin choisi par
       * ce test, qui doit contenir le Dockerfile pour que la suite du
       * build (ensureDockerfile, docker.buildImage avec context =
       * sourcePath) le trouve. Le mock doit donc écrire dans
       * l'argument reçu, exactement comme le ferait un vrai
       * `git clone` vers ce même chemin.
       */
      mockCloneRepository.mockImplementation(
        async ({
          destination,
        }: {
          destination: string
        }) => {
          await fs.mkdir(destination, {
            recursive: true,
          })

          await fs.writeFile(
            path.join(destination, "Dockerfile"),
            [
              "FROM alpine:latest",
              `LABEL ${TEST_LABEL}`,
              `RUN sleep ${SLEEP_SECONDS}`,
              "",
            ].join("\n"),
          )

          return {
            repositoryUrl:
              "https://github.com/acme/real-docker-test",
            branch: "main",
            destination,
            commitSha: "0".repeat(40),
          }
        },
      )
    })

    afterAll(async () => {
      /*
       * Nettoyage ciblé (label dédié à ce test) — jamais un prune
       * global, qui affecterait des images sans rapport sur la
       * machine. Le répertoire source (DEPLOYMENT_ROOT/<deploymentId>)
       * est déjà nettoyé par buildDeployment() lui-même (removeSource
       * dans son bloc catch, y compris sur timeout).
       */
      await docker
        .pruneImages({
          filters: JSON.stringify({
            label: [TEST_LABEL],
          }),
        })
        .catch(() => {})
    }, 15_000)

    it(
      "annule réellement le build en cours : aucun container ne continue d'exécuter le sleep après l'abort",
      async () => {
        const { buildDeployment, DeploymentTimeoutError } =
          await import("./deployment.js")

        const startedAt = Date.now()

        let caughtError: unknown = null

        try {
          await buildDeployment({
            siteName: "real-docker-test",
            repositoryUrl:
              "https://github.com/acme/real-docker-test",
            branch: "main",
            buildTimeoutMs: BUILD_TIMEOUT_MS,
          })
        } catch (error) {
          caughtError = error
        }

        const elapsedMs = Date.now() - startedAt

        expect(caughtError).toBeInstanceOf(
          DeploymentTimeoutError,
        )

        /*
         * Preuve n°1 : l'appel a bien été interrompu près du timeout
         * demandé (quelques secondes), PAS après les 45 s complètes
         * du sleep — ce qui indiquerait que la coupure de connexion a
         * été ignorée et que le build a continué jusqu'à son terme
         * naturel avant que l'erreur ne "remonte".
         */
        expect(elapsedMs).toBeLessThan(SLEEP_SECONDS * 1000)

        /*
         * Preuve n°1bis (condition nécessaire du test lui-même) :
         * l'abort a bien eu lieu APRÈS que l'étape RUN sleep a
         * réellement démarré côté daemon — sinon ce test ne prouve
         * qu'une annulation pendant l'étape FROM (résolution d'image),
         * jamais l'arrêt d'un process RUN effectivement en cours, ce
         * qui est précisément le fait que la revue indépendante
         * demandait de vérifier.
         */
        const logs = (
          caughtError as { logs?: string } | null
        )?.logs

        expect(logs).toContain(
          `RUN sleep ${SLEEP_SECONDS}`,
        )

        /*
         * Preuve n°2 (la question réellement posée par la revue) :
         * quelques secondes après l'abandon, AUCUN container Docker
         * ne doit plus être en train d'exécuter notre "sleep 45" —
         * sinon le process aurait survécu à la coupure de connexion
         * HTTP, consommant des ressources jusqu'à la fin naturelle du
         * sleep (exactement le scénario qu'un timeout "JavaScript
         * seulement" laisserait se produire).
         */
        await new Promise((resolve) =>
          setTimeout(resolve, 3_000),
        )

        const containers = await docker.listContainers({
          all: true,
        })

        const survivingBuildContainers = containers.filter(
          (container) =>
            container.Command?.includes(
              `sleep ${SLEEP_SECONDS}`,
            ) && container.State === "running",
        )

        expect(survivingBuildContainers).toEqual([])
      },
      // BUILD_TIMEOUT_MS (20 s) + 3 s d'attente de vérification + marge.
      40_000,
    )
  },
)
