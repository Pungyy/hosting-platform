import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { getAgentSiteLogs } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedSite } from "@/lib/resources/sites"
import { fetchSiteLogs } from "@/app/api/sites/[id]/logs/route"

/*
 * Route historique fusionnée avec le système d'autorisation de
 * /api/sites/[id]/logs — cf. le commentaire équivalent dans
 * .../action/route.ts pour le raisonnement complet.
 */
export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      id: string
      name: string
    }>
  },
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id: serverId, name } = await context.params

    const siteLookup = await query<{ id: string }>(
      `
        SELECT id
        FROM sites
        WHERE server_id = $1 AND name = $2
        LIMIT 1
      `,
      [serverId, name],
    )

    const siteId = siteLookup.rows[0]?.id

    if (siteId) {
      const { site, response: ownedError } = await getOwnedSite(
        siteId,
        session,
      )
      if (ownedError) return ownedError

      try {
        const logs = await fetchSiteLogs(site)
        return NextResponse.json({ status: "ok", logs })
      } catch (agentError) {
        return apiErrorResponse(
          agentError,
          "GET /api/servers/[id]/sites/[name]/logs (agent) error:",
          "Impossible de récupérer les logs.",
          502,
        )
      }
    }

    /*
     * Container orphelin : réservé aux admins.
     */
    const { response: roleError } = requireAdmin(session)
    if (roleError) return roleError

    try {
      const result = await getAgentSiteLogs(serverId, name)
      return NextResponse.json(result)
    } catch (agentError) {
      return apiErrorResponse(
        agentError,
        "GET /api/servers/[id]/sites/[name]/logs (agent, orphelin) error:",
        "Impossible de récupérer les logs.",
        502,
      )
    }
  } catch (error) {
    return apiErrorResponse(
      error,
      "GET /api/servers/[id]/sites/[name]/logs error:",
      "Impossible de récupérer les logs.",
    )
  }
}
