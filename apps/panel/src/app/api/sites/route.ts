import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth/guard"
import { resolveListScope } from "@/lib/auth/roles"
import {
  createAgentSite,
  deleteAgentSite,
  getAgentSiteStatuses,
} from "@/lib/agent/client"
import { query } from "@/lib/database"

const createSiteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Le nom doit contenir au moins 3 caractères.")
    .max(40, "Le nom ne peut pas dépasser 40 caractères.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Le nom doit contenir uniquement des lettres minuscules, chiffres et tirets.",
    ),
})

type SiteRow = {
  id: string
  name: string
  container_name: string
  container_id: string | null
  image: string
  status: string
  created_at: string
  server_id: string
}

type AgentCreatedSite = {
  id: string
  name: string
  containerName: string
  image: string
  state: string
  running: boolean
}

type AgentSiteStatus = {
  name: string | null
  containerId: string
  containerName: string | null
  status: string
  running: boolean
}

/*
 * Un Agent est considéré joignable si un heartbeat a été reçu
 * récemment. On évite ainsi d'attendre le timeout d'un Agent
 * injoignable (ex. tunnel mort) à chaque rafraîchissement.
 */
const RECENT_HEARTBEAT_MS = 2 * 60 * 1000

/*
 * GET /api/sites
 *
 * Sites PostgreSQL + synchronisation de leur statut avec Docker,
 * en interrogeant l'Agent de CHAQUE serveur (pas seulement le local).
 */
export async function GET(request: Request) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const scopeResult = resolveListScope(request, session)
    if (scopeResult.response) return scopeResult.response

    const sitesResult = await query<SiteRow>(
      `
        SELECT
          s.id,
          s.name,
          s.container_name,
          s.container_id,
          s.image,
          s.status,
          s.created_at,
          s.server_id
        FROM sites s
        ${scopeResult.scope === "own" ? "WHERE s.user_id = $1" : ""}
        ORDER BY s.created_at DESC
      `,
      scopeResult.scope === "own" ? [session.user_id] : [],
    )

    const sites = sitesResult.rows

    /*
     * Serveurs à interroger : ceux qui portent au moins un site ET
     * qui sont contactables — soit un Agent enrôlé vu récemment,
     * soit un serveur sans `agent_url` (fallback dev local, voir
     * lib/agent/client.ts → getAgentConfig). Ce deuxième cas est
     * important : le heartbeat de l'Agent local met à jour la ligne
     * `servers` correspondant à SON enrôlement (ex. "Test VPS"), pas
     * forcément celle à laquelle les sites locaux sont rattachés
     * (ex. "Local Docker", qui n'a jamais de `last_seen_at`).
     */
    const serversResult = await query<{
      id: string
      agent_url: string | null
      last_seen_at: string | null
    }>(`SELECT id, agent_url, last_seen_at FROM servers`)

    const now = Date.now()

    const freshServerIds = new Set(
      serversResult.rows
        .filter(
          (row) =>
            row.agent_url === null ||
            (row.last_seen_at !== null &&
              now - new Date(row.last_seen_at).getTime() <
                RECENT_HEARTBEAT_MS),
        )
        .map((row) => row.id),
    )

    const siteServerIds = [
      ...new Set(sites.map((site) => site.server_id)),
    ]

    const targetServerIds = siteServerIds.filter((id) =>
      freshServerIds.has(id),
    )

    /*
     * Récupération des statuts, un appel par serveur, en parallèle.
     */
    const statusByKey = new Map<string, AgentSiteStatus>()
    const unreachableServers: string[] = []

    const settled = await Promise.allSettled(
      targetServerIds.map(async (serverId) => {
        const data = await getAgentSiteStatuses(serverId)
        return { serverId, agentSites: data.sites }
      }),
    )

    settled.forEach((result, index) => {
      const serverId = targetServerIds[index]

      if (result.status === "rejected") {
        unreachableServers.push(serverId)
        console.error(
          `GET /api/sites — Agent injoignable (serveur ${serverId}) :`,
          result.reason,
        )
        return
      }

      for (const agentSite of result.value.agentSites) {
        if (agentSite.name) {
          statusByKey.set(
            `${serverId}:${agentSite.name}`,
            agentSite,
          )
        }
      }
    })

    const contactedServerIds = new Set(
      targetServerIds.filter(
        (id) => !unreachableServers.includes(id),
      ),
    )

    /*
     * Réconciliation PostgreSQL <- état réel Docker, uniquement
     * pour les sites dont le serveur a répondu.
     */
    for (const site of sites) {
      if (!contactedServerIds.has(site.server_id)) {
        continue
      }

      const agentSite = statusByKey.get(
        `${site.server_id}:${site.name}`,
      )

      if (!agentSite) {
        if (site.status !== "stopped") {
          await query(
            `UPDATE sites SET status = 'stopped' WHERE id = $1`,
            [site.id],
          )
          site.status = "stopped"
        }
        continue
      }

      const newStatus = agentSite.running ? "online" : "stopped"

      if (site.status !== newStatus) {
        await query(
          `UPDATE sites SET status = $1 WHERE id = $2`,
          [newStatus, site.id],
        )
        site.status = newStatus
      }

      if (site.container_id !== agentSite.containerId) {
        await query(
          `UPDATE sites SET container_id = $1 WHERE id = $2`,
          [agentSite.containerId, site.id],
        )
        site.container_id = agentSite.containerId
      }
    }

    const fullySynced =
      unreachableServers.length === 0 &&
      contactedServerIds.size === siteServerIds.length

    return NextResponse.json({
      status: "ok",
      sites,
      sync: {
        status: fullySynced ? "synchronized" : "partial",
        unreachableServers,
      },
    })
  } catch (error) {
    console.error("GET /api/sites error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer les sites.",
      },
      { status: 500 },
    )
  }
}

/*
 * POST /api/sites
 *
 * Création d'un site sur le premier serveur joignable.
 */
export async function POST(request: Request) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const body = await request.json().catch(() => null)

    const parsed = createSiteSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Données invalides.",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const { name } = parsed.data

    /*
     * Choix du serveur : le plus ancien qui soit contactable — Agent
     * enrôlé vu récemment, ou serveur sans `agent_url` (fallback dev
     * local, voir getAgentConfig). Pas la colonne `status`, potentiellement
     * obsolète.
     */
    const serverResult = await query<{
      id: string
      name: string
      hostname: string
    }>(
      `
        SELECT id, name, hostname
        FROM servers
        WHERE agent_url IS NULL
           OR last_seen_at > NOW() - INTERVAL '2 minutes'
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )

    if (serverResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Aucun serveur joignable pour héberger le site.",
        },
        { status: 503 },
      )
    }

    const server = serverResult.rows[0]

    const existingSite = await query<{ id: string }>(
      `SELECT id FROM sites WHERE name = $1 LIMIT 1`,
      [name],
    )

    if (existingSite.rows.length > 0) {
      return NextResponse.json(
        {
          status: "error",
          message: `Le site "${name}" existe déjà.`,
        },
        { status: 409 },
      )
    }

    /*
     * Création du container via l'Agent du serveur choisi.
     */
    let agentSite: AgentCreatedSite

    try {
      const agentResponse = (await createAgentSite(server.id, {
        name,
      })) as { site?: AgentCreatedSite }

      if (!agentResponse.site) {
        throw new Error(
          "L'Agent n'a pas retourné les informations du site.",
        )
      }

      agentSite = agentResponse.site
    } catch (agentError) {
      return NextResponse.json(
        {
          status: "error",
          message:
            agentError instanceof Error
              ? agentError.message
              : "Impossible de créer le site sur l'Agent.",
        },
        { status: 502 },
      )
    }

    const userId = session.user_id

    try {
      const siteResult = await query<SiteRow>(
        `
          INSERT INTO sites (
            user_id,
            server_id,
            name,
            container_name,
            container_id,
            image,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            name,
            container_name,
            container_id,
            image,
            status,
            created_at,
            server_id
        `,
        [
          userId,
          server.id,
          name,
          agentSite.containerName,
          agentSite.id,
          agentSite.image,
          agentSite.running ? "online" : "stopped",
        ],
      )

      const site = siteResult.rows[0]

      await query(
        `
          INSERT INTO domains (site_id, domain, is_primary)
          VALUES ($1, $2, true)
          ON CONFLICT DO NOTHING
        `,
        [site.id, `${name}.localhost`],
      )

      return NextResponse.json({ status: "ok", site }, { status: 201 })
    } catch (databaseError) {
      console.error(
        "POST /api/sites — échec BDD après création Agent :",
        databaseError,
      )

      /*
       * Nettoyage best-effort du container orphelin.
       */
      await deleteAgentSite(server.id, name).catch((cleanupError) => {
        console.error(
          "POST /api/sites — nettoyage du container impossible :",
          cleanupError,
        )
      })

      return NextResponse.json(
        {
          status: "error",
          message:
            "Le container a été créé mais son enregistrement en base a échoué.",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("POST /api/sites error:", error)

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de créer le site.",
      },
      { status: 500 },
    )
  }
}
