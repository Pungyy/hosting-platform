import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { getAgentDatabaseLogs } from "@/lib/agent/client"
import { apiErrorResponse } from "@/lib/http/api-error"
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
      return apiErrorResponse(
        agentError,
        "GET /api/databases/[id]/logs (agent) error:",
        "Impossible de récupérer les logs.",
        502,
      )
    }
  } catch (error) {
    return apiErrorResponse(
      error,
      "GET /api/databases/[id]/logs error:",
      "Impossible de récupérer les logs.",
    )
  }
}
