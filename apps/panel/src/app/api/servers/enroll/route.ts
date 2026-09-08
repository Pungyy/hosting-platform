import { createHash, randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"

import { query } from "@/lib/database"
import { encryptAgentToken } from "@/lib/agent/crypto"

const enrollSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "Le token est obligatoire."),

  hostname: z
    .string()
    .trim()
    .min(
      1,
      "Le hostname est obligatoire.",
    )
    .max(
      255,
      "Le hostname ne peut pas dépasser 255 caractères.",
    ),

  agentVersion: z
    .string()
    .trim()
    .max(50)
    .optional(),

  agentUrl: z
    .string()
    .trim()
    .url("L'URL de l'Agent est invalide.")
    .max(500),
})

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json()

    const parsed =
      enrollSchema.safeParse(
        body,
      )

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Données d'enrôlement invalides.",
          errors:
            parsed.error.flatten(),
        },
        {
          status: 400,
        },
      )
    }

    const {
      token,
      hostname,
      agentVersion,
      agentUrl,
    } = parsed.data

    /*
     * Le token d'enrôlement reçu n'est jamais
     * comparé directement à la BDD.
     *
     * On calcule son SHA-256 et on recherche
     * uniquement ce hash.
     */
    const tokenHash =
      createHash("sha256")
        .update(token)
        .digest("hex")

    /*
     * Recherche le serveur correspondant
     * au token d'enrôlement.
     */
    const result =
      await query<{
        id: string
        name: string
        hostname: string
        enrollment_token_expires_at:
          string | null
        agent_version:
          string | null
      }>(
        `
          SELECT
            id,
            name,
            hostname,
            enrollment_token_expires_at,
            agent_version
          FROM servers
          WHERE enrollment_token_hash = $1
          LIMIT 1
        `,
        [
          tokenHash,
        ],
      )

    if (
      result.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Token d'enrôlement invalide.",
        },
        {
          status: 401,
        },
      )
    }

    const server =
      result.rows[0]

    /*
     * Vérifie que le token n'est pas expiré.
     */
    if (
      !server.enrollment_token_expires_at ||
      new Date(
        server.enrollment_token_expires_at,
      ).getTime() <=
        Date.now()
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Le token d'enrôlement a expiré.",
        },
        {
          status: 401,
        },
      )
    }

    /*
     * Génère le token permanent de l'Agent.
     *
     * Le token brut sera envoyé une seule fois
     * à l'Agent.
     */
    const agentToken =
      randomBytes(32).toString("hex")

    /*
     * Hash utilisé pour vérifier les tokens
     * présentés par l'Agent.
     */
    const agentTokenHash =
      createHash("sha256")
        .update(agentToken)
        .digest("hex")

    /*
     * Version chiffrée utilisée par le Panel
     * lorsqu'il doit communiquer avec l'Agent.
     *
     * Le token en clair n'est jamais stocké
     * en BDD.
     */
    const agentTokenEncrypted =
      encryptAgentToken(agentToken)

    /*
     * Marque le serveur comme enrôlé,
     * enregistre l'URL de l'Agent et stocke :
     *
     * - le hash du token pour l'authentification
     * - le token chiffré pour les communications
     *
     * Le token d'enrôlement est immédiatement
     * invalidé après utilisation.
     */
    const updateResult =
      await query<{
        id: string
        name: string
        hostname: string
        status: string
        agent_version:
          string | null
        enrolled_at: string
        last_seen_at: string
      }>(
        `
          UPDATE servers
          SET
            hostname = $1,
            agent_url = $2,
            status = 'online',
            agent_version =
              COALESCE($3, agent_version),
            enrolled_at = NOW(),
            last_seen_at = NOW(),
            enrollment_token_hash = NULL,
            enrollment_token_expires_at = NULL,
            agent_token_hash = $5,
            agent_token_encrypted = $6,
            updated_at = NOW()
          WHERE id = $4
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
          hostname,
          agentUrl,
          agentVersion ?? null,
          server.id,
          agentTokenHash,
          agentTokenEncrypted,
        ],
      )

    if (
      updateResult.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Impossible de finaliser l'enrôlement.",
        },
        {
          status: 500,
        },
      )
    }

    const enrolledServer =
      updateResult.rows[0]

    /*
     * Le token permanent en clair est retourné
     * uniquement lors de l'enrôlement.
     */
    return NextResponse.json({
      status: "ok",

      server: {
        id:
          enrolledServer.id,

        name:
          enrolledServer.name,

        hostname:
          enrolledServer.hostname,

        status:
          enrolledServer.status,

        agentVersion:
          enrolledServer.agent_version,

        enrolledAt:
          enrolledServer.enrolled_at,

        lastSeenAt:
          enrolledServer.last_seen_at,
      },

      authentication: {
        token: agentToken,
      },
    })
  } catch (error) {
    console.error(
      "POST /api/servers/enroll error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de finaliser l'enrôlement.",
      },
      {
        status: 500,
      },
    )
  }
}