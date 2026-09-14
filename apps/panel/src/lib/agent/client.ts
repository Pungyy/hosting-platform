import { decryptAgentToken } from "@/lib/agent/crypto"
import { ssrfSafeFetch } from "@/lib/agent/ssrf-guard"
import { query } from "@/lib/database"

type AgentResponse = {
  status?: string
  message?: string
  [key: string]: unknown
}

/*
 * Erreur levée quand l'Agent répond avec un statut HTTP non-2xx.
 * Conserve le corps JSON complet de sa réponse (`data`) — notamment le
 * champ `timeout` que l'Agent positionne quand un build de déploiement
 * a été annulé pour dépassement du délai de sécurité (finding H1) —
 * pour que l'appelant puisse distinguer un timeout d'un échec réel
 * sans avoir à analyser le texte du message.
 */
export class AgentRequestError extends Error {
  readonly status: number
  readonly data: AgentResponse

  constructor(message: string, status: number, data: AgentResponse) {
    super(message)
    this.name = "AgentRequestError"
    this.status = status
    this.data = data
  }
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

        /*
         * Configuré directement par l'opérateur dans son propre .env
         * (jamais issu d'un enrôlement attaquable) — seul ce chemin
         * peut légitimement cibler la loopback (Agent local de dev).
         */
        isFallback: true,
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

    isFallback: false,
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
    isFallback,
  } =
    await getAgentConfig(
      serverId,
    )

  let response: {
    ok: boolean
    status: number
    text: () => Promise<string>
  }

  try {
    response =
      await ssrfSafeFetch(
        `${agentUrl}${path}`,
        {
          method: options.method,

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

            ...(options.headers as
              | Record<string, string>
              | undefined ?? {}),
          },

          body:
            typeof options.body === "string"
              ? options.body
              : undefined,
        },
        { allowLoopback: isFallback },
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
    throw new AgentRequestError(
      data.message ??
        `L'Agent a retourné HTTP ${response.status}.`,
      response.status,
      data,
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

/*
 * Budget de temps du déploiement (finding H1, correction de l'invariant
 * timeout Agent / stale-lock Panel).
 *
 * Le PANEL est l'unique source de vérité : il décide de la durée
 * maximale qu'il autorise pour TOUTE l'opération de déploiement côté
 * Agent (build + remplacement du container + nettoyage des anciennes
 * images), et transmet explicitement cette valeur à l'Agent à chaque
 * appel (`deploymentTimeoutMs`, voir controllers/deployments.ts côté
 * Agent). Aucun import entre apps/panel et apps/agent n'est nécessaire
 * ni possible : la valeur voyage comme une donnée HTTP ordinaire, à
 * chaque requête, sans cache ni risque de désynchronisation — l'Agent
 * retombe sur ses propres valeurs par défaut si le champ est absent
 * (rétrocompatibilité), et plafonne de son côté ce qu'il accepte
 * (défense en profondeur contre une valeur envoyée aberrante).
 *
 * lib/resources/deployments.ts DÉRIVE son seuil de réclamation
 * ("stale lock") de CETTE MÊME constante (+ une marge), au lieu de
 * choisir un second nombre indépendant — c'est ce qui rend l'invariant
 * structurellement impossible à casser silencieusement.
 */
export const AGENT_BUILD_BUDGET_MS = 8 * 60 * 1000
export const AGENT_POST_BUILD_BUDGET_MS = 2 * 60 * 1000
export const AGENT_DEPLOYMENT_TIMEOUT_MS =
  AGENT_BUILD_BUDGET_MS + AGENT_POST_BUILD_BUDGET_MS

/*
 * Budget de temps de la sauvegarde (finding M2, "timeout pg_dump") —
 * même principe que AGENT_DEPLOYMENT_TIMEOUT_MS ci-dessus : le Panel
 * décide de la durée totale qu'il autorise pour l'ENSEMBLE de
 * l'opération pg_dump côté Agent (toutes les tentatives de retry
 * comprises), la transmet explicitement (`backupTimeoutMs`, voir
 * controllers/backups.ts côté Agent), et lib/resources/backups.ts
 * dérive son seuil de réclamation ("stale lock") de cette même
 * constante plutôt que de choisir un second nombre indépendant.
 *
 * Valeur choisie pour préserver EXACTEMENT le timeout HTTP déjà en
 * place ci-dessous (10 min, inchangé) tout en le rendant dérivé d'un
 * budget explicite plutôt que d'un nombre isolé.
 */
export const AGENT_BACKUP_TIMEOUT_MS = 9 * 60 * 1000

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
      body: JSON.stringify({
        ...data,
        deploymentTimeoutMs: AGENT_DEPLOYMENT_TIMEOUT_MS,
      }),

      /*
       * Le build (clone + docker build + swap de container + nettoyage)
       * est synchrone côté Agent. Le budget qu'on lui a explicitement
       * transmis (AGENT_DEPLOYMENT_TIMEOUT_MS) doit TOUJOURS expirer
       * avant ce timeout HTTP, sinon le Panel abandonnerait avant que
       * l'Agent n'ait eu la moindre chance de répondre proprement —
       * marge d'une minute pour le transit réseau/traitement de la
       * réponse.
       */
      signal: AbortSignal.timeout(
        AGENT_DEPLOYMENT_TIMEOUT_MS + 60_000,
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

      body: JSON.stringify({
        backupTimeoutMs: AGENT_BACKUP_TIMEOUT_MS,
      }),

      /*
       * `pg_dump` est synchrone côté Agent, comme le build de
       * déploiement — peut prendre du temps sur une grosse base. Le
       * budget transmis (AGENT_BACKUP_TIMEOUT_MS) doit TOUJOURS
       * expirer avant ce timeout HTTP, sinon le Panel abandonnerait
       * avant que l'Agent n'ait eu la moindre chance de répondre
       * proprement — marge d'une minute pour le transit réseau, comme
       * pour le déploiement (finding H1).
       */
      signal: AbortSignal.timeout(
        AGENT_BACKUP_TIMEOUT_MS + 60_000,
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
    isFallback,
  } =
    await getAgentConfig(
      serverId,
    )

  let response: {
    ok: boolean
    status: number
    body: ReadableStream<Uint8Array> | null
  }

  try {
    response =
      await ssrfSafeFetch(
        `${agentUrl}/databases/${encodeURIComponent(databaseName)}/backups/${encodeURIComponent(filename)}`,
        {
          signal: AbortSignal.timeout(
            DEFAULT_TIMEOUT_MS,
          ),

          headers: {
            Authorization:
              `Bearer ${agentToken}`,
          },
        },
        { allowLoopback: isFallback },
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