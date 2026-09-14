import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { migrateAgentDatabaseNetwork } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * POST /api/databases/[id]/migrate-network
 *
 * Étape 1 (additive) de la migration hosting-sites -> réseau tenant
 * dédié — voir le commentaire équivalent sur
 * /api/sites/[id]/migrate-network.
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
        FROM databases
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    const database = result.rows[0]

    if (!database) {
      return NextResponse.json(
        { status: "error", message: "Base de données introuvable." },
        { status: 404 },
      )
    }

    const migration = await migrateAgentDatabaseNetwork(
      database.server_id,
      database.name,
      database.user_id,
    )

    return NextResponse.json({ status: "ok", migration })
  } catch (error) {
    return apiErrorResponse(
      error,
      "POST /api/databases/[id]/migrate-network error:",
      "Impossible de migrer le réseau de la base de données.",
    )
  }
}
