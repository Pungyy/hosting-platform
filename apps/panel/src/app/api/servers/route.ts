import { NextResponse } from "next/server"
import { z } from "zod"

import { query } from "@/lib/database"

const createServerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom est obligatoire.")
    .max(
      100,
      "Le nom ne peut pas dépasser 100 caractères.",
    ),

  hostname: z
    .string()
    .trim()
    .min(1, "Le hostname est obligatoire.")
    .max(
      255,
      "Le hostname ne peut pas dépasser 255 caractères.",
    ),

  ipAddress: z
    .string()
    .trim()
    .max(45)
    .optional()
    .or(z.literal("")),
})

export async function GET() {
  try {
    const result = await query<{
      id: string
      name: string
      hostname: string
      ip_address: string | null
      status: string
      agent_version: string | null

      cpu_usage: string | null
      memory_usage: string | null
      disk_usage: string | null

      memory_total: string | null
      memory_used: string | null

      disk_total: string | null
      disk_used: string | null

      uptime_seconds: string | null

      last_seen_at: string | null
      enrolled_at: string | null
      created_at: string
      updated_at: string
    }>(
      `
        SELECT
          id,
          name,
          hostname,
          ip_address::text AS ip_address,
          status,
          agent_version,

          cpu_usage::text AS cpu_usage,
          memory_usage::text AS memory_usage,
          disk_usage::text AS disk_usage,

          memory_total::text AS memory_total,
          memory_used::text AS memory_used,

          disk_total::text AS disk_total,
          disk_used::text AS disk_used,

          uptime_seconds::text AS uptime_seconds,

          last_seen_at,
          enrolled_at,
          created_at,
          updated_at
        FROM servers
        ORDER BY created_at DESC
      `,
    )

    return NextResponse.json({
      status: "ok",

      servers: result.rows.map(
        (server) => ({
          id: server.id,
          name: server.name,
          hostname: server.hostname,

          ipAddress:
            server.ip_address,

          status:
            server.status,

          agentVersion:
            server.agent_version,

          metrics: {
            cpuUsage:
              server.cpu_usage !== null
                ? Number(
                    server.cpu_usage,
                  )
                : null,

            memoryUsage:
              server.memory_usage !== null
                ? Number(
                    server.memory_usage,
                  )
                : null,

            diskUsage:
              server.disk_usage !== null
                ? Number(
                    server.disk_usage,
                  )
                : null,

            memoryTotal:
              server.memory_total !== null
                ? Number(
                    server.memory_total,
                  )
                : null,

            memoryUsed:
              server.memory_used !== null
                ? Number(
                    server.memory_used,
                  )
                : null,

            diskTotal:
              server.disk_total !== null
                ? Number(
                    server.disk_total,
                  )
                : null,

            diskUsed:
              server.disk_used !== null
                ? Number(
                    server.disk_used,
                  )
                : null,

            uptimeSeconds:
              server.uptime_seconds !== null
                ? Number(
                    server.uptime_seconds,
                  )
                : null,
          },

          lastSeenAt:
            server.last_seen_at,

          enrolledAt:
            server.enrolled_at,

          createdAt:
            server.created_at,

          updatedAt:
            server.updated_at,
        }),
      ),
    })
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des serveurs :",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de récupérer les serveurs.",
      },
      {
        status: 500,
      },
    )
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json()

    const parsed =
      createServerSchema.safeParse(
        body,
      )

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Données invalides.",
          errors:
            parsed.error.flatten(),
        },
        {
          status: 400,
        },
      )
    }

    const {
      name,
      hostname,
      ipAddress,
    } = parsed.data

    const result =
      await query<{
        id: string
        name: string
        hostname: string
        ip_address: string | null
        status: string
        agent_version: string | null
        last_seen_at: string | null
        created_at: string
        updated_at: string
      }>(
        `
          INSERT INTO servers (
            name,
            hostname,
            ip_address,
            status
          )
          VALUES (
            $1,
            $2,
            NULLIF($3, '')::inet,
            'offline'
          )
          RETURNING
            id,
            name,
            hostname,
            ip_address,
            status,
            agent_version,
            last_seen_at,
            created_at,
            updated_at
        `,
        [
          name,
          hostname,
          ipAddress ?? "",
        ],
      )

    return NextResponse.json(
      {
        status: "ok",
        server:
          result.rows[0],
      },
      {
        status: 201,
      },
    )
  } catch (error) {
    console.error(
      "Erreur lors de la création du serveur :",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de créer le serveur.",
      },
      {
        status: 500,
      },
    )
  }
}