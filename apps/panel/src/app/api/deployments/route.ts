import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { query } from "@/lib/database"

const MAX_DEPLOYMENTS = 100

/*
 * GET /api/deployments
 *
 * Historique global des déploiements, tous sites confondus.
 * Déclencher un déploiement reste une action par site
 * (/api/sites/[id]/deploy) — cette route est en lecture seule.
 */
export async function GET() {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

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
        ORDER BY dep.created_at DESC
        LIMIT $1
      `,
      [MAX_DEPLOYMENTS],
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
