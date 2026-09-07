import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"

import { query } from "@/lib/database"

const authenticateSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "Le token est obligatoire."),
})

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json()

    const parsed =
      authenticateSchema.safeParse(
        body,
      )

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Données d'authentification invalides.",
          errors:
            parsed.error.flatten(),
        },
        {
          status: 400,
        },
      )
    }

    const { token } =
      parsed.data

    /*
     * Le token permanent n'est jamais
     * comparé directement à la BDD.
     *
     * On calcule son SHA-256 puis on recherche
     * uniquement le hash stocké.
     */
    const tokenHash =
      createHash("sha256")
        .update(token)
        .digest("hex")

    /*
     * Recherche le serveur correspondant
     * au token permanent.
     */
    const result =
      await query<{
        id: string
        name: string
        hostname: string
        status: string
        agent_version: string | null
        enrolled_at: string | null
      }>(
        `
          SELECT
            id,
            name,
            hostname,
            status,
            agent_version,
            enrolled_at
          FROM servers
          WHERE agent_token_hash = $1
          LIMIT 1
        `,
        [
          tokenHash,
        ],
      )

    /*
     * Aucun serveur ne possède ce token.
     */
    if (
      result.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Token Agent invalide.",
        },
        {
          status: 401,
        },
      )
    }

    const server =
      result.rows[0]

    /*
     * Met à jour la dernière activité
     * du serveur.
     */
    const updateResult =
      await query<{
        id: string
        name: string
        hostname: string
        status: string
        agent_version: string | null
        enrolled_at: string | null
        last_seen_at: string
      }>(
        `
          UPDATE servers
          SET
            status = 'online',
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            name,
            hostname,
            status,
            agent_version,
            enrolled_at,
            last_seen_at
        `,
        [
          server.id,
        ],
      )

    if (
      updateResult.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Impossible de mettre à jour le serveur.",
        },
        {
          status: 500,
        },
      )
    }

    const authenticatedServer =
      updateResult.rows[0]

    return NextResponse.json({
      status: "ok",

      server: {
        id:
          authenticatedServer.id,

        name:
          authenticatedServer.name,

        hostname:
          authenticatedServer.hostname,

        status:
          authenticatedServer.status,

        agentVersion:
          authenticatedServer.agent_version,

        enrolledAt:
          authenticatedServer.enrolled_at,

        lastSeenAt:
          authenticatedServer.last_seen_at,
      },
    })
  } catch (error) {
    console.error(
      "POST /api/servers/authenticate error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible d'authentifier l'Agent.",
      },
      {
        status: 500,
      },
    )
  }
}