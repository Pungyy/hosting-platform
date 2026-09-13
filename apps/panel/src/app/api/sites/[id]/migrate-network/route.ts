import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { migrateAgentSiteNetwork } from "@/lib/agent/client"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * POST /api/sites/[id]/migrate-network
 *
 * Étape 1 (additive) de la migration hosting-sites -> réseau tenant
 * dédié : rattache le container Docker existant de ce site à son
 * réseau hosting-tenant-<user_id>, EN PLUS du réseau legacy —
 * idempotent, sans redémarrage. Jamais appelée automatiquement :
 * uniquement sur déclenchement explicite d'un admin, ressource par
 * ressource.
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
      user_id: string
      server_id: string
    }>(
      `
        SELECT name, user_id, server_id
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

    const migration = await migrateAgentSiteNetwork(
      site.server_id,
      site.name,
      site.user_id,
    )

    return NextResponse.json({ status: "ok", migration })
  } catch (error) {
    console.error(
      "POST /api/sites/[id]/migrate-network error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de migrer le réseau du site.",
      },
      { status: 500 },
    )
  }
}
