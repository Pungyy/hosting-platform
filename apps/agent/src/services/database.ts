import { randomBytes } from "node:crypto"

import Docker from "dockerode"

import { config } from "../config.js"
import { deleteAllBackups } from "./backup.js"
import {
  ensureNetwork,
  getTenantNetworkName,
  validateTenantId,
} from "./docker.js"

const docker = new Docker()

const DB_PREFIX = "hosting-db-"

const DOCKER_LOG_CONFIG = {
  Type: "json-file",
  Config: {
    "max-size": "10m",
    "max-file": "3",
  },
}

/*
 * Un seul moteur pour l'instant (Postgres). Ajouter MySQL / MariaDB /
 * Redis plus tard revient à ajouter une entrée ici — le reste du
 * fichier (création, statut, actions, logs, suppression) est déjà
 * générique par rapport au moteur.
 */
type EngineConfig = {
  image: string
  port: number
  dataPath: string
  env: (
    databaseName: string,
    username: string,
    password: string,
  ) => Record<string, string>
}

const ENGINES: Record<string, EngineConfig> = {
  postgres: {
    image: "postgres:16-alpine",
    port: 5432,
    dataPath: "/var/lib/postgresql/data",
    env: (databaseName, username, password) => ({
      POSTGRES_DB: databaseName,
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password,
    }),
  },
}

export type CreateDatabaseInput = {
  name: string
  engine: string
  tenantId: string
}

export type DatabaseAction = "start" | "stop" | "restart"

function getContainerName(name: string) {
  return `${DB_PREFIX}${name}`
}

function getVolumeName(name: string) {
  return `${getContainerName(name)}-data`
}

function validateDatabaseName(name: string) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    name.length < 3 ||
    name.length > 40
  ) {
    throw new Error("Nom de base de données invalide.")
  }
}

/*
 * Recherche d'un container par son nom exact.
 *
 * Duplique volontairement l'équivalent de services/docker.ts (non
 * exporté) plutôt que de coupler les deux fichiers : la logique des
 * sites, déjà vérifiée en profondeur, reste inchangée.
 */
async function getContainerByExactName(containerName: string) {
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

async function getDatabaseContainer(name: string) {
  validateDatabaseName(name)
  return getContainerByExactName(getContainerName(name))
}

/*
 * Statuts de toutes les bases de données gérées par la plateforme,
 * repérées par leurs labels (comme getManagedSiteStatuses côté sites).
 */
export async function getManagedDatabaseStatuses() {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({
      label: [
        "hosting.platform.managed=true",
        "hosting.platform.type=database",
      ],
    }),
  })

  return containers.map((container) => {
    const name =
      container.Labels?.["hosting.platform.database"] ??
      container.Names?.[0]?.replace(/^\/hosting-db-/, "") ??
      null

    return {
      name,
      containerId: container.Id,
      containerName:
        container.Names?.[0]?.replace(/^\//, "") ?? null,
      status: container.State ?? "unknown",
      running: container.State === "running",
    }
  })
}

/*
 * Création d'une base de données isolée.
 *
 * Réseau `hosting-sites` uniquement : pas de `hosting-proxy` (une base
 * n'est pas routée par Traefik), pas de port publié sur l'hôte.
 */
export async function createDatabase({
  name,
  engine,
  tenantId,
}: CreateDatabaseInput) {
  validateDatabaseName(name)
  validateTenantId(tenantId)

  const engineConfig = ENGINES[engine]

  if (!engineConfig) {
    throw new Error(
      `Moteur de base de données non supporté : "${engine}".`,
    )
  }

  const containerName = getContainerName(name)

  const existingContainer =
    await getContainerByExactName(containerName)

  if (existingContainer) {
    throw new Error(
      `La base de données "${name}" existe déjà.`,
    )
  }

  const tenantNetwork = getTenantNetworkName(tenantId)

  await ensureNetwork(tenantNetwork)

  const databaseName = name.replace(/-/g, "_")
  const username = `${databaseName}_user`
  const password = randomBytes(24).toString("hex")
  const volumeName = getVolumeName(name)

  await docker.createVolume({ Name: volumeName })

  const envVars = engineConfig.env(
    databaseName,
    username,
    password,
  )

  const container = await docker.createContainer({
    name: containerName,

    Image: engineConfig.image,

    Env: Object.entries(envVars).map(
      ([key, value]) => `${key}=${value}`,
    ),

    HostConfig: {
      RestartPolicy: {
        Name: "unless-stopped",
      },

      Memory: 512 * 1024 * 1024,

      NanoCpus: 500_000_000,

      PidsLimit: 200,

      Privileged: false,

      SecurityOpt: ["no-new-privileges:true"],

      /*
       * Comme pour les sites (services/docker.ts) : l'image officielle
       * démarre en root pour ajuster les permissions du volume de
       * données puis bascule vers l'utilisateur du moteur (postgres).
       *
       * Différence avec les sites : au premier démarrage le volume est
       * vide et appartient à root, donc chown/chmod par le root du
       * container passent sans capacité particulière (on est
       * propriétaire). Après ce premier démarrage, `$PGDATA` appartient
       * à `postgres` (999) — sur un redémarrage suivant, le root de
       * l'entrypoint doit à nouveau chmod/parcourir ce répertoire qu'il
       * ne possède plus, ce qui nécessite FOWNER (chmod/chown sur un
       * fichier non possédé) et DAC_OVERRIDE (traverser/lire malgré les
       * bits de permission). Sans elles, le premier `docker start`
       * fonctionne mais tout redémarrage suivant boucle en crash
       * (« chmod: Operation not permitted »).
       */
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "FOWNER", "DAC_OVERRIDE", "SETGID", "SETUID"],

      AutoRemove: false,

      LogConfig: DOCKER_LOG_CONFIG,

      Binds: [`${volumeName}:${engineConfig.dataPath}`],
    },

    NetworkingConfig: {
      EndpointsConfig: {
        [tenantNetwork]: {},
      },
    },

    Labels: {
      "hosting.platform.managed": "true",
      "hosting.platform.type": "database",
      "hosting.platform.database": name,
      "hosting.platform.tenant": tenantId,
      "hosting.platform.engine": engine,
      "hosting.platform.version": "1",
    },
  })

  try {
    await container.start()
  } catch (error) {
    try {
      await container.remove({ force: true })
    } catch {
      // Nettoyage best-effort.
    }

    try {
      await docker.getVolume(volumeName).remove({ force: true })
    } catch {
      // Nettoyage best-effort.
    }

    throw error
  }

  const inspect = await container.inspect()

  return {
    id: inspect.Id,
    name,
    containerName,
    image: engineConfig.image,
    engine,
    databaseName,
    username,
    password,
    port: engineConfig.port,
    state: inspect.State?.Status ?? "unknown",
    running: inspect.State?.Running ?? false,
  }
}

export async function executeDatabaseAction(
  name: string,
  action: DatabaseAction,
) {
  const container = await getDatabaseContainer(name)

  if (!container) {
    throw new Error(
      `Le container de la base "${name}" est introuvable.`,
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

  const inspect = await container.inspect()

  return {
    name,
    containerId: inspect.Id,
    status: inspect.State?.Status ?? "unknown",
    running: inspect.State?.Running ?? false,
  }
}

export async function getDatabaseLogs(name: string) {
  const container = await getDatabaseContainer(name)

  if (!container) {
    throw new Error(
      `Le container de la base "${name}" est introuvable.`,
    )
  }

  const logs = await container.logs({
    stdout: true,
    stderr: true,
    timestamps: true,
    tail: 200,
    follow: false,
  })

  const output: Buffer[] = []
  let offset = 0

  /*
   * Docker retourne les logs avec un header de 8 octets (comme
   * pour les sites — voir services/docker.ts:getSiteLogs).
   */
  while (offset + 8 <= logs.length) {
    const size = logs.readUInt32BE(offset + 4)
    offset += 8

    if (size <= 0) {
      continue
    }

    const end = Math.min(offset + size, logs.length)
    output.push(logs.subarray(offset, end))
    offset = end
  }

  return Buffer.concat(output).toString("utf8")
}

export async function deleteDatabase(name: string) {
  const container = await getDatabaseContainer(name)

  if (container) {
    try {
      await container.remove({ force: true })
    } catch (error) {
      console.error(
        `Impossible de supprimer le container ${name}:`,
        error,
      )
    }
  }

  try {
    await docker
      .getVolume(getVolumeName(name))
      .remove({ force: true })
  } catch (error) {
    console.error(
      `Impossible de supprimer le volume de ${name}:`,
      error,
    )
  }

  try {
    await deleteAllBackups(name)
  } catch (error) {
    console.error(
      `Impossible de supprimer les sauvegardes de ${name}:`,
      error,
    )
  }

  return {
    name,
    deleted: true,
  }
}

/*
 * Migration réseau (hosting-sites -> hosting-tenant-<uuid>) — même
 * principe que les fonctions équivalentes de services/docker.ts
 * (duplication volontaire, ce fichier reste autonome). Jamais
 * appelées automatiquement : uniquement sur déclenchement explicite
 * d'un admin, via les routes dédiées.
 */
export async function migrateDatabaseToTenantNetwork(
  name: string,
  tenantId: string,
) {
  validateDatabaseName(name)
  validateTenantId(tenantId)

  const container = await getDatabaseContainer(name)

  if (!container) {
    throw new Error(
      `Le container de la base "${name}" est introuvable.`,
    )
  }

  const inspect = await container.inspect()

  const existingTenant =
    inspect.Config?.Labels?.["hosting.platform.tenant"]

  if (existingTenant && existingTenant !== tenantId) {
    throw new Error(
      "Le tenant fourni ne correspond pas au propriétaire existant de cette base.",
    )
  }

  const tenantNetwork = getTenantNetworkName(tenantId)

  await ensureNetwork(tenantNetwork)

  const alreadyConnected = Boolean(
    inspect.NetworkSettings?.Networks?.[tenantNetwork],
  )

  if (!alreadyConnected) {
    await docker
      .getNetwork(tenantNetwork)
      .connect({ Container: inspect.Id })
  }

  return {
    name,
    tenantNetwork,
    connected: true,
    legacyNetworkStillAttached: Boolean(
      inspect.NetworkSettings?.Networks?.[config.dockerNetwork],
    ),
  }
}

export async function disconnectDatabaseFromLegacyNetwork(
  name: string,
) {
  validateDatabaseName(name)

  const container = await getDatabaseContainer(name)

  if (!container) {
    throw new Error(
      `Le container de la base "${name}" est introuvable.`,
    )
  }

  const inspect = await container.inspect()

  const stillConnected = Boolean(
    inspect.NetworkSettings?.Networks?.[config.dockerNetwork],
  )

  if (stillConnected) {
    await docker
      .getNetwork(config.dockerNetwork)
      .disconnect({ Container: inspect.Id })
  }

  return {
    name,
    disconnected: true,
  }
}
