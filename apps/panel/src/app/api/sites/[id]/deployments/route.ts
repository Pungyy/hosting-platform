import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedSite } from "@/lib/resources/sites"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type DeploymentRow = {
  id: string
  site_id: string
  commit_sha: string | null
  branch: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  logs: string | null
  created_at: string
  image_name: string | null
  image_id: string | null
  container_name: string | null
  container_id: string | null
}

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { response: ownedError } = await getOwnedSite(id, session)
    if (ownedError) return ownedError

    const deploymentsResult =
      await query<DeploymentRow>(
        `
          SELECT
            id,
            site_id,
            commit_sha,
            branch,
            status,
            started_at,
            finished_at,
            logs,
            created_at,
            image_name,
            image_id,
            container_name,
            container_id
          FROM deployments
          WHERE site_id = $1
          ORDER BY created_at DESC
        `,
        [id],
      )

    return NextResponse.json({
      status: "ok",
      deployments:
        deploymentsResult.rows,
    })
  } catch (error) {
    return apiErrorResponse(
      error,
      "GET /api/sites/[id]/deployments error:",
      "Impossible de récupérer les déploiements.",
    )
  }
}