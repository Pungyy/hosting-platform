import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

import Docker from "dockerode"

import { cloneRepository } from "./git.js"
import {
  createDeploymentContainer,
} from "./docker.js"

const docker = new Docker()

const DEPLOYMENT_ROOT =
  process.env.DEPLOYMENT_ROOT ??
  "E:/Dev/hosting-platform/.tmp/deployments"

const IMAGE_PREFIX = "hosting"

export type BuildDeploymentInput = {
  siteName: string
  repositoryUrl: string
  branch: string
}

export type BuildDeploymentResult = {
  deploymentId: string
  siteName: string
  repositoryUrl: string
  branch: string
  commitSha: string
  sourcePath: string
  imageName: string
  imageId: string
  logs: string
}

export type DeployDeploymentResult =
  BuildDeploymentResult & {
    container: {
      id: string
      name: string
      containerName: string
      image: string
      containerPort: number
      state: string
      running: boolean
    }
  }

class DeploymentBuildError extends Error {
  logs: string

  constructor(
    message: string,
    logs: string,
  ) {
    super(message)

    this.name =
      "DeploymentBuildError"

    this.logs = logs
  }
}

function createDeploymentId() {
  return crypto.randomUUID()
}

function validateSiteName(name: string) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      name,
    )
  ) {
    throw new Error(
      "Nom de site invalide.",
    )
  }
}

function getImageName(
  siteName: string,
  deploymentId: string,
) {
  return `${IMAGE_PREFIX}/${siteName}:${deploymentId}`
}

async function ensureDirectory(
  directory: string,
) {
  await fs.mkdir(
    directory,
    {
      recursive: true,
    },
  )
}

async function ensureDockerfile(
  sourcePath: string,
) {
  const dockerfilePath =
    path.join(
      sourcePath,
      "Dockerfile",
    )

  try {
    const stats =
      await fs.stat(
        dockerfilePath,
      )

    if (!stats.isFile()) {
      throw new Error(
        "Le Dockerfile n'est pas un fichier valide.",
      )
    }
  } catch {
    throw new Error(
      "Aucun Dockerfile trouvé à la racine du repository.",
    )
  }

  return dockerfilePath
}

async function removeImage(
  imageName: string,
) {
  try {
    const image =
      docker.getImage(
        imageName,
      )

    await image.remove({
      force: true,
    })

    console.log(
      `[cleanup] Image supprimée : ${imageName}`,
    )
  } catch {
    /*
     * L'image peut ne plus exister.
     * Nettoyage best-effort.
     */
  }
}

async function removeSource(
  sourcePath: string,
) {
  try {
    await fs.rm(
      sourcePath,
      {
        recursive: true,
        force: true,
      },
    )
  } catch {
    /*
     * Nettoyage best-effort.
     */
  }
}

/*
 * Supprime les anciennes images d'un site.
 *
 * IMPORTANT :
 * l'image actuellement utilisée par le
 * container est toujours conservée.
 */
async function cleanupOldImages(
  siteName: string,
  currentImageName: string,
) {
  const repository =
    `${IMAGE_PREFIX}/${siteName}:`

  console.log(
    `[cleanup] Recherche des anciennes images pour ${siteName}...`,
  )

  /*
   * Récupération de toutes les images Docker.
   */
  const images =
    await docker.listImages({
      all: true,
    })

  /*
   * Récupération de tous les containers.
   */
  const containers =
    await docker.listContainers({
      all: true,
    })

  /*
   * Récupération de l'image actuellement utilisée.
   */
  const currentImage =
    docker.getImage(
      currentImageName,
    )

  let currentImageId: string | null =
    null

  try {
    const currentInspect =
      await currentImage.inspect()

    currentImageId =
      currentInspect.Id
  } catch {
    console.warn(
      `[cleanup] Impossible d'inspecter l'image active : ${currentImageName}`,
    )
  }

  for (
    const imageInfo of images
  ) {
    const tags =
      imageInfo.RepoTags ?? []

    /*
     * IMPORTANT :
     * Une seule ImageInfo peut contenir
     * plusieurs tags.
     *
     * On parcourt donc TOUS les tags.
     */
    for (
      const tag of tags
    ) {
      /*
       * On ne s'intéresse qu'aux images
       * générées pour ce site.
       */
      if (
        !tag.startsWith(
          repository,
        )
      ) {
        continue
      }

      /*
       * Le tag actuellement actif
       * ne doit jamais être supprimé.
       */
      if (
        tag ===
        currentImageName
      ) {
        console.log(
          `[cleanup] Image active conservée : ${tag}`,
        )

        continue
      }

      /*
       * Si cet ancien tag pointe vers
       * la même image physique que l'image active,
       * on peut supprimer uniquement ce tag.
       *
       * L'image physique restera présente grâce
       * au tag actif.
       */
      if (
        currentImageId &&
        imageInfo.Id ===
          currentImageId
      ) {
        console.log(
          `[cleanup] Suppression de l'ancien tag : ${tag}`,
        )

        await removeImage(
          tag,
        )

        continue
      }

      /*
       * L'image physique est différente.
       *
       * On vérifie si elle est utilisée
       * par un container.
       */
      const imageIsUsed =
        containers.some(
          (container) =>
            container.Image ===
              imageInfo.Id ||
            container.Image ===
              tag,
        )

      if (imageIsUsed) {
        console.log(
          `[cleanup] Image conservée car utilisée : ${tag}`,
        )

        continue
      }

      /*
       * Image différente et inutilisée :
       * suppression complète.
       */
      console.log(
        `[cleanup] Suppression de l'ancienne image : ${tag}`,
      )

      await removeImage(
        tag,
      )
    }
  }

  console.log(
    `[cleanup] Nettoyage terminé pour ${siteName}.`,
  )
}

export async function buildDeployment({
  siteName,
  repositoryUrl,
  branch,
}: BuildDeploymentInput): Promise<BuildDeploymentResult> {
  validateSiteName(siteName)

  if (!repositoryUrl) {
    throw new Error(
      "Repository GitHub manquant.",
    )
  }

  if (!branch) {
    throw new Error(
      "Branche GitHub manquante.",
    )
  }

  const deploymentId =
    createDeploymentId()

  const sourcePath =
    path.join(
      DEPLOYMENT_ROOT,
      deploymentId,
    )

  const imageName =
    getImageName(
      siteName,
      deploymentId,
    )

  let buildLogs = ""

  try {
    await ensureDirectory(
      DEPLOYMENT_ROOT,
    )

    /*
     * Clone du repository.
     */
    console.log(
      `[deployment ${deploymentId}] Clone du repository...`,
    )

    const repository =
      await cloneRepository({
        repositoryUrl,
        branch,
        destination:
          sourcePath,
      })

    const commitSha =
      repository.commitSha

    buildLogs +=
      `Repository : ${repositoryUrl}\n`

    buildLogs +=
      `Branche : ${branch}\n`

    buildLogs +=
      `Commit : ${commitSha}\n\n`

    /*
     * Vérification du Dockerfile.
     */
    console.log(
      `[deployment ${deploymentId}] Vérification du Dockerfile...`,
    )

    await ensureDockerfile(
      sourcePath,
    )

    buildLogs +=
      "Dockerfile trouvé.\n\n"

    /*
     * Build de l'image.
     */
    console.log(
      `[deployment ${deploymentId}] Build de l'image ${imageName}...`,
    )

    buildLogs +=
      `Build de l'image ${imageName}...\n\n`

    const stream =
      await docker.buildImage(
        {
          context:
            sourcePath,

          src: ["."],
        },
        {
          t: imageName,

          pull: true,

          rm: true,
        },
      )

    await new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        docker.modem.followProgress(
          stream,

          (
            error,
            output,
          ) => {
            if (error) {
              reject(
                new DeploymentBuildError(
                  error.message,
                  buildLogs,
                ),
              )

              return
            }

            const buildError =
              output?.find(
                (
                  event: {
                    error?: string
                    errorDetail?: {
                      message?: string
                    }
                  },
                ) =>
                  event.error ||
                  event.errorDetail
                    ?.message,
              )

            if (buildError) {
              const message =
                buildError.error ??
                buildError
                  .errorDetail
                  ?.message ??
                "Le build Docker a échoué."

              reject(
                new DeploymentBuildError(
                  message,
                  buildLogs,
                ),
              )

              return
            }

            resolve()
          },

          (
            event: {
              stream?: string
              error?: string
              errorDetail?: {
                message?: string
              }
            },
          ) => {
            if (event.stream) {
              buildLogs +=
                event.stream

              process.stdout.write(
                event.stream,
              )
            }

            if (
              event.error ||
              event.errorDetail
                ?.message
            ) {
              const message =
                event.error ??
                event.errorDetail
                  ?.message ??
                "Erreur Docker inconnue."

              buildLogs +=
                `\nERREUR : ${message}\n`

              console.error(
                message,
              )
            }
          },
        )
      },
    )

    /*
     * Vérification de l'image créée.
     */
    const image =
      docker.getImage(
        imageName,
      )

    const inspect =
      await image.inspect()

    console.log(
      `[deployment ${deploymentId}] Image créée : ${inspect.Id}`,
    )

    buildLogs +=
      `\nBuild terminé avec succès.\n`

    buildLogs +=
      `Image : ${imageName}\n`

    buildLogs +=
      `Image ID : ${inspect.Id}\n`

    /*
     * Le contexte Git n'est plus nécessaire
     * après le build.
     */
    await removeSource(
      sourcePath,
    )

    return {
      deploymentId,

      siteName,

      repositoryUrl,

      branch,

      commitSha,

      sourcePath,

      imageName,

      imageId:
        inspect.Id,

      logs:
        buildLogs,
    }
  } catch (error) {
    console.error(
      `[deployment ${deploymentId}] Échec :`,
      error,
    )

    /*
     * Si l'erreur contient les logs
     * du build, on les conserve.
     */
    if (
      error instanceof
      DeploymentBuildError
    ) {
      buildLogs =
        error.logs
    }

    await removeSource(
      sourcePath,
    )

    await removeImage(
      imageName,
    )

    if (
      error instanceof
      DeploymentBuildError
    ) {
      throw new Error(
        `${error.message}\n\n${buildLogs}`,
      )
    }

    throw error
  }
}

export async function deployDeployment({
  siteName,
  repositoryUrl,
  branch,
}: BuildDeploymentInput): Promise<DeployDeploymentResult> {
  const build =
    await buildDeployment({
      siteName,
      repositoryUrl,
      branch,
    })

  try {
    /*
     * Création et remplacement
     * du container.
     */
    const container =
      await createDeploymentContainer({
        siteName,

        imageName:
          build.imageName,
      })

    /*
     * Le nouveau container est maintenant
     * actif et fonctionnel.
     *
     * On peut donc nettoyer les anciennes
     * images du site.
     */
    console.log(
      `[deployment ${build.deploymentId}] Nettoyage des anciennes images...`,
    )

    await cleanupOldImages(
      siteName,
      build.imageName,
    )

    return {
      ...build,

      container,
    }
  } catch (error) {
    /*
     * Le build a réussi mais le déploiement
     * du container a échoué.
     *
     * L'image n'est alors plus nécessaire.
     */
    await removeImage(
      build.imageName,
    )

    throw new Error(
      `${
        error instanceof Error
          ? error.message
          : "Impossible de créer le container."
      }\n\n${build.logs}`,
    )
  }
}