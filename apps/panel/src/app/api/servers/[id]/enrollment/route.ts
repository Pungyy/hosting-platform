import { createHash, randomBytes } from "node:crypto"
import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id } = await context.params

    /*
     * Génère un token aléatoire de 32 octets.
     * Le token brut ne sera jamais stocké en BDD.
     */
    const enrollmentToken =
      randomBytes(32).toString("hex")

    /*
     * Stocke uniquement le hash SHA-256.
     */
    const enrollmentTokenHash =
      createHash("sha256")
        .update(enrollmentToken)
        .digest("hex")

    /*
     * Le token est valable pendant 30 minutes.
     */
    const expiresAt =
      new Date(
        Date.now() +
          30 * 60 * 1000,
      )

    /*
     * Vérifie que le serveur existe
     * et génère son token d'enrôlement.
     */
    const result =
      await query<{
        id: string
        name: string
        hostname: string
        enrollment_token_expires_at: string
      }>(
        `
          UPDATE servers
          SET
            enrollment_token_hash = $1,
            enrollment_token_expires_at = $2,
            updated_at = NOW()
          WHERE id = $3
          RETURNING
            id,
            name,
            hostname,
            enrollment_token_expires_at
        `,
        [
          enrollmentTokenHash,
          expiresAt,
          id,
        ],
      )

    if (
      result.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Serveur introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const server =
      result.rows[0]

    /*
     * Le token brut est retourné uniquement
     * lors de cette génération.
     */
    return NextResponse.json(
      {
        status: "ok",

        server: {
          id: server.id,
          name: server.name,
          hostname: server.hostname,
        },

        enrollment: {
          token: enrollmentToken,
          expiresAt:
            server.enrollment_token_expires_at,
        },
      },
      {
        status: 201,
      },
    )
  } catch (error) {
    console.error(
      "Erreur lors de la génération du token d'enrôlement :",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de générer le token d'enrôlement.",
      },
      {
        status: 500,
      },
    )
  }
}