import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { deleteAgentDatabase } from "@/lib/agent/client"
import { decryptSecret } from "@/lib/agent/crypto"
import { query } from "@/lib/database"
import { getOwnedDatabase } from "@/lib/resources/databases"

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
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { database: owned, response: ownedError } = await getOwnedDatabase(
      id,
      session,
    )
    if (ownedError) return ownedError

    const { password_encrypted, ...database } = owned

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
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { database, response: ownedError } = await getOwnedDatabase(
      id,
      session,
    )
    if (ownedError) return ownedError

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- extrait volontairement pour l'exclure de la réponse
    const { password_encrypted, ...safeDatabase } = database

    return NextResponse.json({
      status: "ok",
      message: "Base de données supprimée.",
      database: safeDatabase,
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
