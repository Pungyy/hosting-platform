import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { getAgentDatabaseLogs } from "@/lib/agent/client"
import { getOwnedDatabase } from "@/lib/resources/databases"

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
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { database, response: ownedError } = await getOwnedDatabase(
      id,
      session,
    )
    if (ownedError) return ownedError

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
