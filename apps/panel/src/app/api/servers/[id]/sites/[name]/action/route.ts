import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { agentSiteAction } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedSite } from "@/lib/resources/sites"
import {
  ALLOWED_SITE_ACTIONS,
  performSiteAction,
  type SiteAction,
} from "@/app/api/sites/[id]/action/route"

/*
 * Route historique, appelée par l'onglet Docker de la page serveur
 * (qui identifie un container par son nom plutôt que par l'id du site).
 * Fusionnée avec le système d'autorisation de /api/sites/[id]/action —
 * un seul chemin d'autorisation, pas deux : si le nom correspond à un
 * site suivi en base, on applique exactement la même vérification de
 * propriétaire (getOwnedSite) et la même exécution (performSiteAction)
 * que la route moderne. Les containers orphelins (aucune ligne `sites`
 * correspondante, gérés uniquement depuis l'onglet Docker) restent
 * accessibles, mais réservés aux admins — cf. décision produit "Docker
 * sur la page serveur = admin uniquement".
 */
export async function POST(
  request: Request,
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

    const body = await request.json().catch(() => null)
    const action = body?.action as SiteAction

    if (!ALLOWED_SITE_ACTIONS.includes(action)) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Action invalide. Actions autorisées : start, stop, restart.",
        },
        { status: 400 },
      )
    }

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
        const { status: siteStatus, ...result } = await performSiteAction(
          site,
          action,
        )
        return NextResponse.json({
          status: "ok",
          ...result,
          site: { ...site, status: siteStatus },
        })
      } catch (agentError) {
        return apiErrorResponse(
          agentError,
          "POST /api/servers/[id]/sites/[name]/action (agent) error:",
          "Impossible d'exécuter l'action.",
          502,
        )
      }
    }

    /*
     * Container orphelin : pas de propriétaire à vérifier, donc
     * réservé aux admins.
     */
    const { response: roleError } = requireAdmin(session)
    if (roleError) return roleError

    try {
      const result = await agentSiteAction(serverId, name, action)
      return NextResponse.json(result)
    } catch (agentError) {
      return apiErrorResponse(
        agentError,
        "POST /api/servers/[id]/sites/[name]/action (agent, orphelin) error:",
        "Impossible d'exécuter l'action.",
        502,
      )
    }
  } catch (error) {
    return apiErrorResponse(
      error,
      "POST /api/servers/[id]/sites/[name]/action error:",
      "Impossible d'exécuter l'action.",
    )
  }
}
