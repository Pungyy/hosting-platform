import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { deleteAgentDatabase } from "@/lib/agent/client"
import { decryptSecret } from "@/lib/agent/crypto"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * GET /api/databases/[id]
 *
 * Contrairement au token d'enrôlement (affiché une seule fois), les
 * identifiants d'une base doivent rester consultables après coup pour
 * configurer une application — route déjà protégée par requireSession().
 */
export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const result = await query<{
      id: string
      name: string
      engine: string
      container_name: string
      container_id: string | null
      image: string
      status: string
      database_name: string
      username: string
      password_encrypted: string
      internal_host: string
      internal_port: number
      created_at: string
      server_id: string
      server_name: string | null
      server_hostname: string | null
    }>(
      `
        SELECT
          d.id,
          d.name,
          d.engine,
          d.container_name,
          d.container_id,
          d.image,
          d.status,
          d.database_name,
          d.username,
          d.password_encrypted,
          d.internal_host,
          d.internal_port,
          d.created_at,
          d.server_id,
          srv.name AS server_name,
          srv.hostname AS server_hostname
        FROM databases d
        LEFT JOIN servers srv
          ON srv.id = d.server_id
        WHERE d.id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Base de données introuvable.",
        },
        { status: 404 },
      )
    }

    const { password_encrypted, ...database } = result.rows[0]

    let password: string

    try {
      password = decryptSecret(password_encrypted)
    } catch (decryptError) {
      console.error(
        "GET /api/databases/[id] — déchiffrement impossible :",
        decryptError,
      )

      return NextResponse.json(
        {
          status: "error",
          message: "Impossible de déchiffrer les identifiants.",
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      status: "ok",
      database: { ...database, password },
    })
  } catch (error) {
    console.error("GET /api/databases/[id] error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer la base de données.",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const result = await query<{
      id: string
      name: string
      server_id: string
    }>(
      `
        SELECT id, name, server_id
        FROM databases
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Base de données introuvable.",
        },
        { status: 404 },
      )
    }

    const database = result.rows[0]

    try {
      await deleteAgentDatabase(database.server_id, database.name)
    } catch (agentError) {
      return NextResponse.json(
        {
          status: "error",
          message:
            agentError instanceof Error
              ? agentError.message
              : "Impossible de supprimer la base de données.",
        },
        { status: 502 },
      )
    }

    await query(`DELETE FROM databases WHERE id = $1`, [id])

    return NextResponse.json({
      status: "ok",
      message: "Base de données supprimée.",
      database,
    })
  } catch (error) {
    console.error("DELETE /api/databases/[id] error:", error)

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de supprimer la base de données.",
      },
      { status: 500 },
    )
  }
}
