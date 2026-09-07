import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

const AGENT_URL =
  process.env.AGENT_URL

const AGENT_TOKEN =
  process.env.AGENT_TOKEN

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { id } = await params

    const result = await query(
      `
        SELECT
          s.id,
          s.name,
          s.container_name,
          s.container_id,
          s.image,
          s.status,
          s.created_at,
          s.server_id,
          srv.name AS server_name,
          srv.hostname AS server_hostname
        FROM sites s
        LEFT JOIN servers srv
          ON srv.id = s.server_id
        WHERE s.id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
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

    return NextResponse.json({
      status: "ok",
      site: result.rows[0],
    })
  } catch (error) {
    console.error(
      "GET /api/sites/[id] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de récupérer le site.",
      },
      {
        status: 500,
      },
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    if (
      !AGENT_URL ||
      !AGENT_TOKEN
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Configuration Agent manquante.",
        },
        {
          status: 500,
        },
      )
    }

    const { id } = await params

    const result = await query<{
      id: string
      name: string
    }>(
      `
        SELECT
          id,
          name
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
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

    const site =
      result.rows[0]

    const response =
      await fetch(
        `${AGENT_URL}/sites/${encodeURIComponent(
          site.name,
        )}`,
        {
          method: "DELETE",
          headers: {
            Authorization:
              `Bearer ${AGENT_TOKEN}`,
          },
          cache: "no-store",
        },
      )

    const data =
      await response
        .json()
        .catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          message:
            data?.message ??
            "Impossible de supprimer le site.",
        },
        {
          status: response.status,
        },
      )
    }

    await query(
      `
        DELETE FROM sites
        WHERE id = $1
      `,
      [id],
    )

    return NextResponse.json({
      status: "ok",
      message: "Site supprimé.",
      site,
    })
  } catch (error) {
    console.error(
      "DELETE /api/sites/[id] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de supprimer le site.",
      },
      {
        status: 500,
      },
    )
  }
}