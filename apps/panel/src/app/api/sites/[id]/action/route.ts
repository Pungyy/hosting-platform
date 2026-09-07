import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type Action =
  | "start"
  | "stop"
  | "restart"

const AGENT_URL =
  process.env.AGENT_URL

const AGENT_TOKEN =
  process.env.AGENT_TOKEN

export async function POST(
  request: Request,
  { params }: RouteContext,
) {
  try {
    if (!AGENT_URL || !AGENT_TOKEN) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Configuration Agent manquante.",
        },
        { status: 500 },
      )
    }

    const { id } = await params

    const body =
      await request.json().catch(() => null)

    const action = body?.action as Action

    if (
      ![
        "start",
        "stop",
        "restart",
      ].includes(action)
    ) {
      return NextResponse.json(
        {
          status: "error",
          message: "Action invalide.",
        },
        { status: 400 },
      )
    }

    const siteResult = await query<{
      id: string
      name: string
      container_name: string
    }>(
      `
        SELECT
          id,
          name,
          container_name
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (siteResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        { status: 404 },
      )
    }

    const site = siteResult.rows[0]

    const response = await fetch(
      `${AGENT_URL}/sites/${encodeURIComponent(
        site.name,
      )}/action`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization: `Bearer ${AGENT_TOKEN}`,
        },
        body: JSON.stringify({
          action,
        }),
        cache: "no-store",
      },
    )

    const data =
      await response.json().catch(
        () => null,
      )

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          message:
            data?.message ??
            "L'Agent a refusé l'action.",
        },
        { status: response.status },
      )
    }

    const dockerStatus =
      data?.site?.status ??
      "unknown"

    const dbStatus =
      data?.site?.running
        ? "online"
        : "stopped"

    await query(
      `
        UPDATE sites
        SET
          status = $1,
          container_id = COALESCE($2, container_id)
        WHERE id = $3
      `,
      [
        dbStatus,
        data?.site?.containerId ??
          null,
        id,
      ],
    )

    return NextResponse.json({
      status: "ok",
      action,
      docker_status: dockerStatus,
      site: {
        ...site,
        status: dbStatus,
        container_id:
          data?.site?.containerId ??
          null,
      },
    })
  } catch (error) {
    console.error(
      "POST /api/sites/[id]/action error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible d'exécuter l'action.",
      },
      { status: 500 },
    )
  }
}