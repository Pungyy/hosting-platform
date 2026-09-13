import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { resolveListScope } from "@/lib/auth/roles"
import { query } from "@/lib/database"

const MAX_DEPLOYMENTS = 100

/*
 * GET /api/deployments
 *
 * Historique des déploiements — par défaut ceux des sites de
 * l'utilisateur courant, ou de tous les tenants pour un admin avec
 * ?scope=all. Déclencher un déploiement reste une action par site
 * (/api/sites/[id]/deploy) — cette route est en lecture seule.
 */
export async function GET(request: Request) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const scopeResult = resolveListScope(request, session)
    if (scopeResult.response) return scopeResult.response

    const params =
      scopeResult.scope === "own"
        ? [session.user_id, MAX_DEPLOYMENTS]
        : [MAX_DEPLOYMENTS]

    const result = await query<{
      id: string
      site_id: string
      commit_sha: string | null
      branch: string | null
      status: string
      started_at: string | null
      finished_at: string | null
      created_at: string
      image_name: string | null
      container_name: string | null
      site_name: string
    }>(
      `
        SELECT
          dep.id,
          dep.site_id,
          dep.commit_sha,
          dep.branch,
          dep.status,
          dep.started_at,
          dep.finished_at,
          dep.created_at,
          dep.image_name,
          dep.container_name,
          s.name AS site_name
        FROM deployments dep
        INNER JOIN sites s
          ON s.id = dep.site_id
        ${scopeResult.scope === "own" ? "WHERE s.user_id = $1" : ""}
        ORDER BY dep.created_at DESC
        LIMIT $${scopeResult.scope === "own" ? "2" : "1"}
      `,
      params,
    )

    return NextResponse.json({
      status: "ok",
      deployments: result.rows,
    })
  } catch (error) {
    console.error("GET /api/deployments error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer les déploiements.",
      },
      { status: 500 },
    )
  }
}
