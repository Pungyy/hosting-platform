import { decryptAgentToken } from "@/lib/agent/crypto"
import { query } from "@/lib/database"

type AgentResponse<T = unknown> = {
  status?: string
  message?: string
  [key: string]: unknown
}

type ServerAgentConfig = {
  agent_url: string | null
  agent_token_encrypted: string | null
}

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

  const response =
    await fetch(
      `${agentUrl}${path}`,
      {
        ...options,

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
  domains: string[],
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