import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { disconnectAgentSiteLegacyNetwork } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * POST /api/sites/[id]/disconnect-legacy-network
 *
 * Étape 2 (isolante) de la migration : retire le réseau legacy
 * hosting-sites du container de ce site. À n'exécuter qu'une fois
 * l'étape 1 (migrate-network) vérifiée pour ce site — idempotent,
 * sans redémarrage. Jamais appelée automatiquement.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { response: roleError } = requireAdmin(session)
    if (roleError) return roleError

    const { id } = await params

    const result = await query<{
      name: string
      server_id: string
    }>(
      `
        SELECT name, server_id
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    const site = result.rows[0]

    if (!site) {
      return NextResponse.json(
        { status: "error", message: "Site introuvable." },
        { status: 404 },
      )
    }

    const migration = await disconnectAgentSiteLegacyNetwork(
      site.server_id,
      site.name,
    )

    return NextResponse.json({ status: "ok", migration })
  } catch (error) {
    return apiErrorResponse(
      error,
      "POST /api/sites/[id]/disconnect-legacy-network error:",
      "Impossible de déconnecter le site du réseau legacy.",
    )
  }
}
