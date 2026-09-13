import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { agentDatabaseAction } from "@/lib/agent/client"
import { query } from "@/lib/database"
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

    return NextResponse.json({
      status: "ok",
      action,
      database: {
        ...database,
        status: dbStatus,
      },
    })
  } catch (error) {
    console.error(
      "POST /api/databases/[id]/action error:",
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
