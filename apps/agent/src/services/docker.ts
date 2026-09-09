import Docker from "dockerode"

import { config } from "../config.js"
import {
  addSiteToTraefik,
  removeSiteFromTraefik,
} from "./traefik.js"

const docker = new Docker()

const SITE_PREFIX = "hosting-site-"
const SITE_IMAGE =
  "nginxinc/nginx-unprivileged:alpine"

const DOCKER_LOG_CONFIG = {
  Type: "json-file",
  Config: {
    "max-size": "10m",
    "max-file": "3",
  },
}

export type CreateSiteInput = {
  name: string
}

export type SiteAction =
  | "start"
  | "stop"
  | "restart"

export type CreateDeploymentContainerInput = {
  siteName: string
  imageName: string
}

function getContainerName(name: string) {
  return `${SITE_PREFIX}${name}`
}

function getDeploymentContainerName(
  siteName: string,
) {
  return `${getContainerName(siteName)}-deployment`
}

function validateSiteName(name: string) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
      name,
    ) ||
    name.length < 3 ||
    name.length > 40
  ) {
    throw new Error(
      "Nom de site invalide.",
    )
  }
}

async function ensureNetwork(
  networkName: string,
) {
  const networks =
    await docker.listNetworks({
      filters: JSON.stringify({
        name: [networkName],
      }),
    })

  const existingNetwork =
    networks.find(
      (network) =>
        network.Name === networkName,
    )

  if (existingNetwork) {
    return docker.getNetwork(
      existingNetwork.Id,
    )
  }

  return docker.createNetwork({
    Name: networkName,
    Driver: "bridge",
    CheckDuplicate: true,
  })
}

async function ensureSiteNetworks() {
  await ensureNetwork(
    config.dockerNetwork,
  )

  await ensureNetwork(
    config.proxyNetwork,
  )
}

async function getContainerByExactName(
  containerName: string,
) {
  const containers =
    await docker.listContainers({
      all: true,
      filters: JSON.stringify({
        name: [
          `^/${containerName}$`,
        ],
      }),
    })

  if (containers.length === 0) {
    return null
  }

  return docker.getContainer(
    containers[0].Id,
  )
}

async function getSiteContainer(
  name: string,
) {
  validateSiteName(name)

  return getContainerByExactName(
    getContainerName(name),
  )
}

export async function getDockerInfo() {
  return docker.info()
}

export async function getDockerContainers() {
  return docker.listContainers({
    all: true,
  })
}

/*
 * Récupère le statut de tous les sites
 * gérés par notre plateforme.
 *
 * On utilise les labels Hosting Platform
 * plutôt que de considérer n'importe quel
 * container Docker comme un site.
 */
export async function getManagedSiteStatuses() {
  const containers =
    await docker.listContainers({
      all: true,
      filters: JSON.stringify({
        label: [
          "hosting.platform.managed=true",
          "hosting.platform.type=site",
        ],
      }),
    })

  return containers.map(
    (container) => {
      const name =
        container.Labels?.[
          "hosting.platform.site"
        ] ??
        container.Names?.[0]
          ?.replace(
            /^\/hosting-site-/,
            "",
          ) ??
        null

      return {
        name,
        containerId:
          container.Id,
        containerName:
          container.Names?.[0]?.replace(
            /^\//,
            "",
          ) ?? null,
        status:
          container.State ??
          "unknown",
        running:
          container.State ===
          "running",
      }
    },
  )
}

/*
 * Création d'un site classique.
 */
export async function createSite({
  name,
}: CreateSiteInput) {
  validateSiteName(name)

  const containerName =
    getContainerName(name)

  const existingContainer =
    await getContainerByExactName(
      containerName,
    )

  if (existingContainer) {
    throw new Error(
      `Le site "${name}" existe déjà.`,
    )
  }

  await ensureSiteNetworks()

  const container =
    await docker.createContainer({
      name: containerName,

      Image: SITE_IMAGE,

      HostConfig: {
        RestartPolicy: {
          Name: "unless-stopped",
        },

        Memory:
          256 * 1024 * 1024,

        NanoCpus:
          500_000_000,

        PidsLimit: 100,

        Privileged: false,

        SecurityOpt: [
          "no-new-privileges:true",
        ],

        CapDrop: ["ALL"],
        CapAdd: ["CHOWN", "SETGID", "SETUID"],

        AutoRemove: false,

        LogConfig:
          DOCKER_LOG_CONFIG,
      },

      NetworkingConfig: {
        EndpointsConfig: {
          [config.dockerNetwork]: {},
          [config.proxyNetwork]: {},
        },
      },

      Labels: {
        "hosting.platform.managed":
          "true",

        "hosting.platform.type":
          "site",

        "hosting.platform.site":
          name,

        "hosting.platform.version":
          "1",

        "traefik.enable":
          "true",

        "traefik.docker.network":
          config.proxyNetwork,

        [`traefik.http.routers.${name}.rule`]:
          `Host(\`${name}.localhost\`)`,

        [`traefik.http.routers.${name}.entrypoints`]:
          "web",

        [`traefik.http.routers.${name}.service`]:
          name,

        [`traefik.http.services.${name}.loadbalancer.server.port`]:
          "8080",
      },
    })

  try {
    await container.start()
  } catch (error) {
    try {
      await container.remove({
        force: true,
      })
    } catch {
      // Nettoyage best-effort.
    }

    throw error
  }

  try {
    await addSiteToTraefik(
      name,
      8080,
    )
  } catch (error) {
    try {
      await container.remove({
        force: true,
      })
    } catch {
      // Nettoyage best-effort.
    }

    throw error
  }

  const inspect =
    await container.inspect()

  return {
    id: inspect.Id,

    name,

    containerName,

    image: SITE_IMAGE,

    state:
      inspect.State?.Status ??
      "unknown",

    running:
      inspect.State?.Running ??
      false,
  }
}

/*
 * Création d'un container à partir
 * d'une image issue d'un deployment.
 *
 * Stratégie :
 *
 * 1. On détecte le port exposé.
 * 2. On crée un container temporaire.
 * 3. On le démarre.
 * 4. On vérifie qu'il tourne.
 * 5. On supprime l'ancien container.
 * 6. On renomme le nouveau container.
 * 7. On met à jour Traefik.
 *
 * Si le nouveau container ne démarre pas,
 * l'ancien container reste intact.
 */
export async function createDeploymentContainer({
  siteName,
  imageName,
}: CreateDeploymentContainerInput) {
  validateSiteName(siteName)

  const containerName =
    getContainerName(siteName)

  const temporaryContainerName =
    getDeploymentContainerName(
      siteName,
    )

  /*
   * Vérifie que l'image existe.
   */
  const image =
    docker.getImage(imageName)

  const imageInspect =
    await image.inspect()

  /*
   * Récupère les ports exposés
   * par l'image Docker.
   */
  const exposedPorts =
    Object.keys(
      imageInspect.Config
        ?.ExposedPorts ?? {},
    )

  if (exposedPorts.length === 0) {
    throw new Error(
      "L'image Docker n'expose aucun port.",
    )
  }

  const httpPort =
    exposedPorts.find(
      (port) =>
        port.endsWith("/tcp"),
    )

  if (!httpPort) {
    throw new Error(
      "Aucun port TCP exposé par l'image Docker.",
    )
  }

  const containerPort =
    Number(
      httpPort.replace(
        "/tcp",
        "",
      ),
    )

  if (
    !Number.isInteger(
      containerPort,
    ) ||
    containerPort <= 0 ||
    containerPort > 65535
  ) {
    throw new Error(
      "Port exposé par l'image invalide.",
    )
  }

  await ensureSiteNetworks()

  /*
   * Si un ancien container temporaire
   * existe après un précédent déploiement
   * interrompu, on le supprime.
   */
  const oldTemporaryContainer =
    await getContainerByExactName(
      temporaryContainerName,
    )

  if (oldTemporaryContainer) {
    try {
      await oldTemporaryContainer.remove({
        force: true,
      })
    } catch (error) {
      throw new Error(
        `Impossible de supprimer le container temporaire "${temporaryContainerName}".`,
      )
    }
  }

  /*
   * Création du nouveau container
   * avec un nom temporaire.
   */
  const newContainer =
    await docker.createContainer({
      name: temporaryContainerName,

      Image: imageName,

      ExposedPorts: {
        [`${containerPort}/tcp`]: {},
      },

      HostConfig: {
        RestartPolicy: {
          Name: "unless-stopped",
        },

        Memory:
          256 * 1024 * 1024,

        NanoCpus:
          500_000_000,

        PidsLimit: 100,

        Privileged: false,

        SecurityOpt: [
          "no-new-privileges:true",
        ],

        CapDrop: ["ALL"],
        CapAdd: ["CHOWN", "SETGID", "SETUID"],

        AutoRemove: false,

        LogConfig:
          DOCKER_LOG_CONFIG,
      },

      NetworkingConfig: {
        EndpointsConfig: {
          [config.dockerNetwork]: {},
          [config.proxyNetwork]: {},
        },
      },

      Labels: {
        "hosting.platform.managed":
          "true",

        "hosting.platform.type":
          "site",

        "hosting.platform.site":
          siteName,

        "hosting.platform.version":
          "1",

        "hosting.platform.image":
          imageName,

        "hosting.platform.port":
          String(containerPort),

        "hosting.platform.deployment":
          "true",

        "traefik.enable":
          "false",
      },
    })

  /*
   * Démarrage du nouveau container.
   */
  try {
    await newContainer.start()
  } catch (error) {
    try {
      await newContainer.remove({
        force: true,
      })
    } catch {
      // Nettoyage best-effort.
    }

    throw new Error(
      `Impossible de démarrer le nouveau container : ${
        error instanceof Error
          ? error.message
          : "erreur inconnue."
      }`,
    )
  }

  /*
   * Vérification du nouveau container.
   */
  let newInspect =
    await newContainer.inspect()

  if (
    !newInspect.State?.Running
  ) {
    try {
      await newContainer.remove({
        force: true,
      })
    } catch {
      // Nettoyage best-effort.
    }

    throw new Error(
      "Le nouveau container n'est pas en cours d'exécution.",
    )
  }

  /*
   * Récupère l'ancien container.
   */
  const oldContainer =
    await getContainerByExactName(
      containerName,
    )

  /*
   * À partir de maintenant, le nouveau
   * container est fonctionnel.
   *
   * On peut donc remplacer l'ancien.
   */
  if (oldContainer) {
    try {
      await oldContainer.remove({
        force: true,
      })
    } catch (error) {
      try {
        await newContainer.remove({
          force: true,
        })
      } catch {
        // Nettoyage best-effort.
      }

      throw new Error(
        `Impossible de supprimer l'ancien container "${containerName}".`,
      )
    }
  }

  /*
   * Renomme le nouveau container avec
   * le nom officiel du site.
   */
  try {
    await newContainer.rename({
      name: containerName,
    })
  } catch (error) {
    /*
     * Le nouveau container fonctionne,
     * mais le renommage a échoué.
     *
     * On tente de restaurer la situation
     * en supprimant le nouveau container.
     */
    try {
      await newContainer.remove({
        force: true,
      })
    } catch {
      // Nettoyage best-effort.
    }

    throw new Error(
      `Impossible de renommer le nouveau container : ${
        error instanceof Error
          ? error.message
          : "erreur inconnue."
      }`,
    )
  }

  /*
   * Récupère le container sous son nouveau nom.
   */
  const finalContainer =
    await getContainerByExactName(
      containerName,
    )

  if (!finalContainer) {
    throw new Error(
      "Le nouveau container est introuvable après le renommage.",
    )
  }

  /*
   * Vérification finale.
   */
  newInspect =
    await finalContainer.inspect()

  if (
    !newInspect.State?.Running
  ) {
    throw new Error(
      "Le nouveau container s'est arrêté après son déploiement.",
    )
  }

  /*
   * Mise à jour de Traefik avec
   * le port réellement exposé.
   */
  try {
    await addSiteToTraefik(
      siteName,
      containerPort,
    )
  } catch (error) {
    /*
     * Le container fonctionne toujours.
     * On ne le supprime pas ici :
     * il vaut mieux conserver le nouveau
     * container que perdre le site.
     */
    console.error(
      `Impossible de mettre à jour Traefik pour ${siteName}:`,
      error,
    )

    throw new Error(
      `Le déploiement du container a réussi, mais la configuration Traefik a échoué : ${
        error instanceof Error
          ? error.message
          : "erreur inconnue."
      }`,
    )
  }

  return {
    id: newInspect.Id,

    name: siteName,

    containerName,

    image: imageName,

    containerPort,

    state:
      newInspect.State?.Status ??
      "unknown",

    running:
      newInspect.State?.Running ??
      false,
  }
}

export async function getSiteStatus(
  name: string,
) {
  const container =
    await getSiteContainer(name)

  if (!container) {
    return {
      exists: false,
      status: "missing",
      running: false,
      containerId: null,
    }
  }

  const inspect =
    await container.inspect()

  return {
    exists: true,

    status:
      inspect.State?.Status ??
      "unknown",

    running:
      inspect.State?.Running ??
      false,

    containerId:
      inspect.Id,
  }
}

export async function executeSiteAction(
  name: string,
  action: SiteAction,
) {
  const container =
    await getSiteContainer(name)

  if (!container) {
    throw new Error(
      `Le container du site "${name}" est introuvable.`,
    )
  }

  if (action === "start") {
    await container.start()
  }

  if (action === "stop") {
    await container.stop()
  }

  if (action === "restart") {
    await container.restart()
  }

  const inspect =
    await container.inspect()

  return {
    name,

    containerId:
      inspect.Id,

    status:
      inspect.State?.Status ??
      "unknown",

    running:
      inspect.State?.Running ??
      false,
  }
}

export async function getSiteLogs(
  name: string,
) {
  const container =
    await getSiteContainer(name)

  if (!container) {
    throw new Error(
      `Le container du site "${name}" est introuvable.`,
    )
  }

  const logs =
    await container.logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail: 200,
      follow: false,
    })

  const output: Buffer[] = []

  let offset = 0

  /*
   * Docker retourne les logs avec
   * un header de 8 octets.
   */
  while (
    offset + 8 <= logs.length
  ) {
    const size =
      logs.readUInt32BE(
        offset + 4,
      )

    offset += 8

    if (size <= 0) {
      continue
    }

    const end = Math.min(
      offset + size,
      logs.length,
    )

    output.push(
      logs.subarray(
        offset,
        end,
      ),
    )

    offset = end
  }

  return Buffer.concat(
    output,
  ).toString("utf8")
}

export async function deleteSite(
  name: string,
) {
  const container =
    await getSiteContainer(name)

  if (container) {
    try {
      await container.remove({
        force: true,
      })
    } catch (error) {
      console.error(
        `Impossible de supprimer le container ${name}:`,
        error,
      )
    }
  }

  await removeSiteFromTraefik(
    name,
  )

  return {
    name,
    deleted: true,
  }
}



