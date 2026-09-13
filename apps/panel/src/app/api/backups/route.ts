import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { resolveListScope } from "@/lib/auth/roles"
import { query } from "@/lib/database"

/*
 * GET /api/backups
 *
 * Vue globale des sauvegardes — par défaut celles des bases de
 * l'utilisateur courant, ou de tous les tenants pour un admin avec
 * ?scope=all. Les mutations (création, suppression) restent sur
 * /api/databases/[id]/backups[/[backupId]] — cette route est en
 * lecture seule, comme /api/domains et /api/deployments.
 */
export async function GET(request: Request) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const scopeResult = resolveListScope(request, session)
    if (scopeResult.response) return scopeResult.response

    const result = await query<{
      id: string
      database_id: string
      filename: string
      size_bytes: string | null
      status: string
      error_message: string | null
      created_at: string
      database_name: string
    }>(
      `
        SELECT
          b.id,
          b.database_id,
          b.filename,
          b.size_bytes,
          b.status,
          b.error_message,
          b.created_at,
          d.name AS database_name
        FROM backups b
        INNER JOIN databases d
          ON d.id = b.database_id
        ${scopeResult.scope === "own" ? "WHERE d.user_id = $1" : ""}
        ORDER BY b.created_at DESC
      `,
      scopeResult.scope === "own" ? [session.user_id] : [],
    )

    return NextResponse.json({
      status: "ok",
      backups: result.rows,
    })
  } catch (error) {
    console.error("GET /api/backups error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer les sauvegardes.",
      },
      { status: 500 },
    )
  }
}
