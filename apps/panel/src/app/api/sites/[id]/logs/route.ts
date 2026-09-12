import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { getAgentSiteLogs } from "@/lib/agent/client"
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
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        { status: 404 },
      )
    }

    const site = result.rows[0]

    try {
      const data = await getAgentSiteLogs(
        site.server_id,
        site.name,
      )

      return NextResponse.json({
        status: "ok",
        logs: data.logs ?? "",
      })
    } catch (agentError) {
      /*
       * Le container peut être momentanément absent pendant un
       * déploiement : on renvoie une erreur propre, non fatale
       * pour le polling du frontend.
       */
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
      "GET /api/sites/[id]/logs error:",
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
