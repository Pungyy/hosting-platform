import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { getAgentSiteLogs } from "@/lib/agent/client"
import { getOwnedSite, type OwnedSite } from "@/lib/resources/sites"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * Récupère les logs d'un site déjà résolu et autorisé. Partagée par cette
 * route et par la route fusionnée /api/servers/[id]/sites/[name]/logs —
 * cf. performSiteAction dans action/route.ts pour le même principe.
 */
export async function fetchSiteLogs(
  site: Pick<OwnedSite, "name" | "server_id">,
) {
  const data = await getAgentSiteLogs(site.server_id, site.name)
  return data.logs ?? ""
}

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { site, response: ownedError } = await getOwnedSite(id, session)
    if (ownedError) return ownedError

    try {
      const logs = await fetchSiteLogs(site)

      return NextResponse.json({
        status: "ok",
        logs,
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
