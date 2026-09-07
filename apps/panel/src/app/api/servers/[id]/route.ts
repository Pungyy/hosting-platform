import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type ServerRow = {
  id: string
  name: string
  hostname: string
  ip_address: string | null
  status: string
  agent_version: string | null
  cpu_usage: number | null
  memory_usage: number | null
  disk_usage: number | null
  memory_total: string | null
  memory_used: string | null
  disk_total: string | null
  disk_used: string | null
  uptime_seconds: string | null
  last_seen_at: string | null
  enrolled_at: string | null
  created_at: string
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      id: string
    }>
  },
) {
  try {
    const { id } = await context.params

    const result = await query<ServerRow>(
      `
        SELECT
          id,
          name,
          hostname,
          ip_address::text AS ip_address,
          status,
          agent_version,
          cpu_usage,
          memory_usage,
          disk_usage,
          memory_total,
          memory_used,
          disk_total,
          disk_used,
          uptime_seconds,
          last_seen_at,
          enrolled_at,
          created_at
        FROM servers
        WHERE id = $1
      `,
      [id],
    )

    if (result.rowCount === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Serveur introuvable.",
        },
        { status: 404 },
      )
    }

    const server = result.rows[0]

    return NextResponse.json({
      status: "ok",

      server: {
        id: server.id,
        name: server.name,
        hostname: server.hostname,
        ipAddress: server.ip_address,
        status: server.status,
        agentVersion: server.agent_version,

        metrics: {
          cpuUsage:
            server.cpu_usage !== null
              ? Number(server.cpu_usage)
              : null,

          memoryUsage:
            server.memory_usage !== null
              ? Number(server.memory_usage)
              : null,

          diskUsage:
            server.disk_usage !== null
              ? Number(server.disk_usage)
              : null,

          memoryTotal:
            server.memory_total !== null
              ? Number(server.memory_total)
              : null,

          memoryUsed:
            server.memory_used !== null
              ? Number(server.memory_used)
              : null,

          diskTotal:
            server.disk_total !== null
              ? Number(server.disk_total)
              : null,

          diskUsed:
            server.disk_used !== null
              ? Number(server.disk_used)
              : null,

          uptimeSeconds:
            server.uptime_seconds !== null
              ? Number(server.uptime_seconds)
              : null,
        },

        lastSeenAt: server.last_seen_at,
        enrolledAt: server.enrolled_at,
        createdAt: server.created_at,
      },
    })
  } catch (error) {
    console.error(
      "GET /api/servers/[id] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de récupérer le serveur.",
      },
      { status: 500 },
    )
  }
}