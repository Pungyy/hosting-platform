import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { getAgentDatabaseLogs } from "@/lib/agent/client"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const result = await query<{
      id: string
      name: string
      server_id: string
    }>(
      `
        SELECT id, name, server_id
        FROM databases
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Base de données introuvable.",
        },
        { status: 404 },
      )
    }

    const database = result.rows[0]

    try {
      const data = await getAgentDatabaseLogs(
        database.server_id,
        database.name,
      )

      return NextResponse.json({
        status: "ok",
        logs: data.logs ?? "",
      })
    } catch (agentError) {
      return NextResponse.json(
        {
          status: "error",
          message:
            agentError instanceof Error
              ? agentError.message
              : "Impossible de récupérer les logs.",
        },
        { status: 502 },
      )
    }
  } catch (error) {
    console.error(
      "GET /api/databases/[id]/logs error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de récupérer les logs.",
      },
      { status: 500 },
    )
  }
}
