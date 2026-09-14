import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { agentDatabaseAction } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedDatabase } from "@/lib/resources/databases"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

const ALLOWED_ACTIONS = ["start", "stop", "restart"] as const

type Action = (typeof ALLOWED_ACTIONS)[number]

type AgentActionResult = {
  status?: string
  database?: {
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
    const { session, response: authError } = await requireSession()
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

    const { database, response: ownedError } = await getOwnedDatabase(
      id,
      session,
    )
    if (ownedError) return ownedError

    let data: AgentActionResult

    try {
      data = (await agentDatabaseAction(
        database.server_id,
        database.name,
        action,
      )) as AgentActionResult
    } catch (agentError) {
      return apiErrorResponse(
        agentError,
        "POST /api/databases/[id]/action (agent) error:",
        "L'Agent a refusé l'action.",
        502,
      )
    }

    const dbStatus = data.database?.running ? "online" : "stopped"

    await query(
      `
        UPDATE databases
        SET
          status = $1,
          container_id = COALESCE($2, container_id),
          updated_at = NOW()
        WHERE id = $3
      `,
      [dbStatus, data.database?.containerId ?? null, id],
    )

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- extrait volontairement pour l'exclure de la réponse
    const { password_encrypted, ...safeDatabase } = database

    return NextResponse.json({
      status: "ok",
      action,
      database: {
        ...safeDatabase,
        status: dbStatus,
      },
    })
  } catch (error) {
    return apiErrorResponse(
      error,
      "POST /api/databases/[id]/action error:",
      "Impossible d'exécuter l'action.",
    )
  }
}
