import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { disconnectAgentDatabaseLegacyNetwork } from "@/lib/agent/client"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * POST /api/databases/[id]/disconnect-legacy-network
 *
 * Étape 2 (isolante) de la migration — voir le commentaire équivalent
 * sur /api/sites/[id]/disconnect-legacy-network.
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

    const migration = await disconnectAgentDatabaseLegacyNetwork(
      database.server_id,
      database.name,
    )

    return NextResponse.json({ status: "ok", migration })
  } catch (error) {
    console.error(
      "POST /api/databases/[id]/disconnect-legacy-network error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de déconnecter la base du réseau legacy.",
      },
      { status: 500 },
    )
  }
}
