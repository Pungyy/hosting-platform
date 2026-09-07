import { NextResponse } from "next/server"

import { query } from "@/lib/database"

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
    const { id } = await params

    const siteResult =
      await query<{ id: string }>(
        `
          SELECT id
          FROM sites
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      )

    if (
      siteResult.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        {
          status: 404,
        },
      )
    }

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
    console.error(
      "GET /api/sites/[id]/deployments error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de récupérer les déploiements.",
      },
      {
        status: 500,
      },
    )
  }
}