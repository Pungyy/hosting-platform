import { NextResponse } from "next/server"

import crypto from "node:crypto"

import { query } from "@/lib/database"

type HeartbeatBody = {
  token: string
  agentVersion?: string

  metrics?: {
    cpu?: {
      usage?: number
    }

    memory?: {
      total?: number
      used?: number
      usage?: number
    }

    disk?: {
      total?: number
      used?: number
      usage?: number
    }

    uptime?: number
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as HeartbeatBody

    if (!body.token) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Token obligatoire.",
        },
        { status: 400 },
      )
    }

    const tokenHash =
      crypto
        .createHash("sha256")
        .update(body.token)
        .digest("hex")

    const result =
      await query<{
        id: string
        name: string
        hostname: string
        status: string
        agent_version: string | null
        last_seen_at: string
      }>(
        `
          UPDATE servers
          SET
            status = 'online',
            agent_version = COALESCE($2, agent_version),
            cpu_usage = $3,
            memory_usage = $4,
            disk_usage = $5,
            memory_total = $6,
            memory_used = $7,
            disk_total = $8,
            disk_used = $9,
            uptime_seconds = $10,
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE agent_token_hash = $1
          RETURNING
            id,
            name,
            hostname,
            status,
            agent_version,
            last_seen_at
        `,
        [
          tokenHash,
          body.agentVersion ?? null,
          body.metrics?.cpu?.usage ?? null,
          body.metrics?.memory?.usage ?? null,
          body.metrics?.disk?.usage ?? null,
          body.metrics?.memory?.total ?? null,
          body.metrics?.memory?.used ?? null,
          body.metrics?.disk?.total ?? null,
          body.metrics?.disk?.used ?? null,
          body.metrics?.uptime != null
          ? Math.floor(body.metrics.uptime)
          : null,
        ],
      )

    if (result.rowCount === 0) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Token Agent invalide.",
        },
        { status: 401 },
      )
    }

    return NextResponse.json({
      status: "ok",
      server: result.rows[0],
    })
  } catch (error) {
    console.error(
      "POST /api/servers/heartbeat error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de traiter le heartbeat.",
      },
      { status: 500 },
    )
  }
}