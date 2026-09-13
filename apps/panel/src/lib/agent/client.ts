import { decryptAgentToken } from "@/lib/agent/crypto"
import { query } from "@/lib/database"

type AgentResponse = {
  status?: string
  message?: string
  [key: string]: unknown
}

type ServerAgentConfig = {
  agent_url: string | null
  agent_token_encrypted: string | null
}

/*
 * Timeout par défaut des appels à l'Agent. Empêche une route du Panel
 * de pendre indéfiniment quand un Agent est injoignable (ex. tunnel mort).
 * Les appels longs (build de déploiement) passent leur propre `signal`.
 */
const DEFAULT_TIMEOUT_MS = 15_000

async function getAgentConfig(
  serverId: string,
) {
  const result =
    await query<ServerAgentConfig>(
      `
        SELECT
          agent_url,
          agent_token_encrypted
        FROM servers
        WHERE id = $1
        LIMIT 1
      `,
      [serverId],
    )

  if (result.rows.length === 0) {
    throw new Error(
      "Serveur introuvable.",
    )
  }

  const server =
    result.rows[0]

  if (
    !server.agent_url ||
    !server.agent_token_encrypted
  ) {
    /*
     * Fallback développement local :
     *
     * le serveur n'est pas encore enrôlé, mais les
     * variables d'environnement de l'Agent local
     * sont disponibles.
     *
     * En production, chaque serveur DOIT être enrôlé
     * (agent_url + token chiffré stockés en base).
     */
    const fallbackUrl =
      process.env.AGENT_URL

    const fallbackToken =
      process.env.AGENT_TOKEN

    if (
      fallbackUrl &&
      fallbackToken
    ) {
      return {
        agentUrl:
          fallbackUrl.replace(
            /\/+$/,
            "",
          ),

        agentToken:
          fallbackToken,
      }
    }

    throw new Error(
      "La connexion de l'Agent n'est pas configurée pour ce serveur.",
    )
  }

  return {
    agentUrl:
      server.agent_url.replace(
        /\/+$/,
        "",
      ),

    agentToken:
      decryptAgentToken(
        server.agent_token_encrypted,
      ),
  }
}

async function agentRequest<T = AgentResponse>(
  serverId: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const {
    agentUrl,
    agentToken,
  } =
    await getAgentConfig(
      serverId,
    )

  let response: Response

  try {
    response =
      await fetch(
        `${agentUrl}${path}`,
        {
          ...options,

          signal:
            options.signal ??
            AbortSignal.timeout(
              DEFAULT_TIMEOUT_MS,
            ),

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${agentToken}`,

            ...(options.headers ?? {}),
          },

          cache: "no-store",
        },
      )
  } catch (error) {
    const name =
      (error as Error).name

    if (
      name === "TimeoutError" ||
      name === "AbortError"
    ) {
      throw new Error(
        "L'Agent n'a pas répondu à temps.",
      )
    }

    throw new Error(
      `Impossible de joindre l'Agent : ${
        (error as Error).message
      }`,
    )
  }

  const text =
    await response.text()

  let data: AgentResponse = {}

  if (text) {
    try {
      data =
        JSON.parse(text)
    } catch {
      throw new Error(
        "Réponse invalide de l'Agent.",
      )
    }
  }

  if (!response.ok) {
    throw new Error(
      data.message ??
        `L'Agent a retourné HTTP ${response.status}.`,
    )
  }

  return data as T
}

export async function getAgentHealth(
  serverId: string,
) {
  return agentRequest<{
    status: string
    service: string
    version: string
  }>(
    serverId,
    "/health",
  )
}

export async function getAgentSiteStatuses(
  serverId: string,
) {
  return agentRequest<{
    status: string
    sites: Array<{
      name: string | null
      containerId: string
      containerName: string | null
      status: string
      running: boolean
    }>
  }>(
    serverId,
    "/sites/statuses",
  )
}

export async function createAgentSite(
  serverId: string,
  data: Record<string, unknown>,
) {
  return agentRequest(
    serverId,
    "/sites",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  )
}

export async function getAgentSiteStatus(
  serverId: string,
  siteName: string,
) {
  return agentRequest(
    serverId,
    `/sites/${encodeURIComponent(siteName)}/status`,
  )
}

export async function agentSiteAction(
  serverId: string,
  siteName: string,
  action: string,
) {
  return agentRequest(
    serverId,
    `/sites/${encodeURIComponent(siteName)}/action`,
    {
      method: "POST",
      body: JSON.stringify({
        action,
      }),
    },
  )
}

export async function updateAgentSiteDomains(
  serverId: string,
  siteName: string,
  domains: Array<{
    domain: string
    sslEnabled?: boolean
  }>,
) {
  return agentRequest(
    serverId,
    `/sites/${encodeURIComponent(siteName)}/domains`,
    {
      method: "PUT",
      body: JSON.stringify({
        domains,
      }),
    },
  )
}

export async function getAgentTraefikConfig(
  serverId: string,
) {
  return agentRequest(
    serverId,
    "/traefik/config",
  )
}

export async function getAgentDockerInfo(
  serverId: string,
) {
  return agentRequest<{
    status: string
    docker: {
      version: string
      containers: {
        total: number
        running: number
      }
    }
  }>(
    serverId,
    "/docker",
  )
}

export async function getAgentSiteLogs(
  serverId: string,
  siteName: string,
) {
  return agentRequest<{
    status: string
    logs: string
  }>(
    serverId,
    `/sites/${encodeURIComponent(siteName)}/logs`,
  )
}

export async function deleteAgentSite(
  serverId: string,
  siteName: string,
) {
  return agentRequest(
    serverId,
    `/sites/${encodeURIComponent(siteName)}`,
    {
      method: "DELETE",
    },
  )
}

/*
 * Migration réseau (hosting-sites -> hosting-tenant-<uuid>) — jamais
 * appelées automatiquement, uniquement depuis une route Panel
 * admin-only déclenchée explicitement.
 */
export async function migrateAgentSiteNetwork(
  serverId: string,
  siteName: string,
  tenantId: string,
) {
  return agentRequest(
    serverId,
    `/sites/${encodeURIComponent(siteName)}/migrate-network`,
    {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    },
  )
}

export async function disconnectAgentSiteLegacyNetwork(
  serverId: string,
  siteName: string,
) {
  return agentRequest(
    serverId,
    `/sites/${encodeURIComponent(siteName)}/disconnect-legacy-network`,
    {
      method: "POST",
    },
  )
}

export async function deployAgentSite(
  serverId: string,
  data: {
    siteName: string
    repositoryUrl: string
    branch: string
    tenantId: string
  },
) {
  return agentRequest(
    serverId,
    "/deployments/build",
    {
      method: "POST",
      body: JSON.stringify(data),

      /*
       * Le build (clone + docker build + swap de container) est
       * synchrone côté Agent et peut durer plusieurs minutes.
       */
      signal: AbortSignal.timeout(
        10 * 60 * 1000,
      ),
    },
  )
}

export async function getAgentDatabaseStatuses(
  serverId: string,
) {
  return agentRequest<{
    status: string
    databases: Array<{
      name: string | null
      containerId: string
      containerName: string | null
      status: string
      running: boolean
    }>
  }>(
    serverId,
    "/databases/statuses",
  )
}

export async function createAgentDatabase(
  serverId: string,
  data: {
    name: string
    engine: string
    tenantId: string
  },
) {
  return agentRequest<{
    status: string
    database?: {
      id: string
      name: string
      containerName: string
      image: string
      engine: string
      databaseName: string
      username: string
      password: string
      port: number
      running: boolean
    }
  }>(
    serverId,
    "/databases",
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  )
}

export async function agentDatabaseAction(
  serverId: string,
  databaseName: string,
  action: string,
) {
  return agentRequest<{
    status: string
    database?: {
      name: string
      containerId: string
      status: string
      running: boolean
    }
  }>(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}/action`,
    {
      method: "POST",
      body: JSON.stringify({
        action,
      }),
    },
  )
}

export async function getAgentDatabaseLogs(
  serverId: string,
  databaseName: string,
) {
  return agentRequest<{
    status: string
    logs: string
  }>(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}/logs`,
  )
}

export async function deleteAgentDatabase(
  serverId: string,
  databaseName: string,
) {
  return agentRequest(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}`,
    {
      method: "DELETE",
    },
  )
}

/*
 * Migration réseau (hosting-sites -> hosting-tenant-<uuid>) — voir le
 * commentaire équivalent sur migrateAgentSiteNetwork.
 */
export async function migrateAgentDatabaseNetwork(
  serverId: string,
  databaseName: string,
  tenantId: string,
) {
  return agentRequest(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}/migrate-network`,
    {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    },
  )
}

export async function disconnectAgentDatabaseLegacyNetwork(
  serverId: string,
  databaseName: string,
) {
  return agentRequest(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}/disconnect-legacy-network`,
    {
      method: "POST",
    },
  )
}

export async function createAgentDatabaseBackup(
  serverId: string,
  databaseName: string,
) {
  return agentRequest<{
    status: string
    backup?: {
      filename: string
      sizeBytes: number
    }
  }>(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}/backups`,
    {
      method: "POST",

      /*
       * `pg_dump` est synchrone côté Agent, comme le build de
       * déploiement — peut prendre du temps sur une grosse base.
       */
      signal: AbortSignal.timeout(
        10 * 60 * 1000,
      ),
    },
  )
}

export async function deleteAgentDatabaseBackup(
  serverId: string,
  databaseName: string,
  filename: string,
) {
  return agentRequest(
    serverId,
    `/databases/${encodeURIComponent(databaseName)}/backups/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
    },
  )
}

/*
 * Contrairement à `agentRequest`, ne parse pas la réponse en JSON : un
 * fichier de sauvegarde est un binaire (.sql.gz), pas un texte JSON.
 * Retourne la `Response` brute pour que la route Panel puisse relayer
 * le flux directement au navigateur.
 */
export async function downloadAgentDatabaseBackup(
  serverId: string,
  databaseName: string,
  filename: string,
) {
  const {
    agentUrl,
    agentToken,
  } =
    await getAgentConfig(
      serverId,
    )

  let response: Response

  try {
    response =
      await fetch(
        `${agentUrl}/databases/${encodeURIComponent(databaseName)}/backups/${encodeURIComponent(filename)}`,
        {
          signal: AbortSignal.timeout(
            DEFAULT_TIMEOUT_MS,
          ),

          headers: {
            Authorization:
              `Bearer ${agentToken}`,
          },

          cache: "no-store",
        },
      )
  } catch (error) {
    const name =
      (error as Error).name

    if (
      name === "TimeoutError" ||
      name === "AbortError"
    ) {
      throw new Error(
        "L'Agent n'a pas répondu à temps.",
      )
    }

    throw new Error(
      `Impossible de joindre l'Agent : ${
        (error as Error).message
      }`,
    )
  }

  return response
}