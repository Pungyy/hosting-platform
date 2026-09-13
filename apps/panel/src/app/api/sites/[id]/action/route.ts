import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { agentSiteAction } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { getOwnedSite, type OwnedSite } from "@/lib/resources/sites"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export const ALLOWED_SITE_ACTIONS = ["start", "stop", "restart"] as const

export type SiteAction = (typeof ALLOWED_SITE_ACTIONS)[number]

type AgentActionResult = {
  status?: string
  site?: {
    name: string
    containerId: string
    status: string
    running: boolean
  }
}

/*
 * Exécute une action sur un site déjà résolu et autorisé (par getOwnedSite
 * ou, pour les routes serveur fusionnées, par la même logique). Partagée
 * par cette route et par la route fusionnée
 * /api/servers/[id]/sites/[name]/action — un seul chemin de code pour
 * "agir sur le container d'un site", quelle que soit l'URL d'entrée.
 */
export async function performSiteAction(
  site: Pick<OwnedSite, "id" | "name" | "server_id">,
  action: SiteAction,
) {
  const data = (await agentSiteAction(
    site.server_id,
    site.name,
    action,
  )) as AgentActionResult

  const dbStatus = data.site?.running ? "online" : "stopped"

  await query(
    `
      UPDATE sites
      SET
        status = $1,
        container_id = COALESCE($2, container_id)
      WHERE id = $3
    `,
    [dbStatus, data.site?.containerId ?? null, site.id],
  )

  return {
    action,
    docker_status: data.site?.status ?? "unknown",
    status: dbStatus,
    containerId: data.site?.containerId ?? null,
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const body = await request.json().catch(() => null)

    const action = body?.action as SiteAction

    if (!ALLOWED_SITE_ACTIONS.includes(action)) {
      return NextResponse.json(
        {
          status: "error",
          message: "Action invalide.",
        },
        { status: 400 },
      )
    }

    const { site, response: ownedError } = await getOwnedSite(id, session)
    if (ownedError) return ownedError

    let result: Awaited<ReturnType<typeof performSiteAction>>

    try {
      result = await performSiteAction(site, action)
    } catch (agentError) {
      return NextResponse.json(
        {
          status: "error",
          message:
            agentError instanceof Error
              ? agentError.message
              : "L'Agent a refusé l'action.",
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      status: "ok",
      action: result.action,
      docker_status: result.docker_status,
      site: {
        ...site,
        status: result.status,
        container_id: result.containerId,
      },
    })
  } catch (error) {
    console.error(
      "POST /api/sites/[id]/action error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible d'exécuter l'action.",
      },
      { status: 500 },
    )
  }
}
