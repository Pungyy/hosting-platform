import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { agentSiteAction } from "@/lib/agent/client"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

const ALLOWED_ACTIONS = ["start", "stop", "restart"] as const

type Action = (typeof ALLOWED_ACTIONS)[number]

type AgentActionResult = {
  status?: string
  site?: {
    name: string
    containerId: string
    status: string
    running: boolean
  }
}

export async function POST(
  request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const body = await request.json().catch(() => null)

    const action = body?.action as Action

    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        {
          status: "error",
          message: "Action invalide.",
        },
        { status: 400 },
      )
    }

    const siteResult = await query<{
      id: string
      name: string
      container_name: string
      server_id: string
    }>(
      `
        SELECT id, name, container_name, server_id
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (siteResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        { status: 404 },
      )
    }

    const site = siteResult.rows[0]

    let data: AgentActionResult

    try {
      data = (await agentSiteAction(
        site.server_id,
        site.name,
        action,
      )) as AgentActionResult
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

    const dbStatus = data.site?.running ? "online" : "stopped"

    await query(
      `
        UPDATE sites
        SET
          status = $1,
          container_id = COALESCE($2, container_id)
        WHERE id = $3
      `,
      [dbStatus, data.site?.containerId ?? null, id],
    )

    return NextResponse.json({
      status: "ok",
      action,
      docker_status: data.site?.status ?? "unknown",
      site: {
        ...site,
        status: dbStatus,
        container_id: data.site?.containerId ?? null,
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
