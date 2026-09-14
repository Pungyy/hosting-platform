import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import {
  createAgentSite,
  getAgentHealth,
  getAgentSiteStatuses,
} from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"

const createSiteSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Le nom doit contenir au moins 3 caractères.")
    .max(40, "Le nom ne peut pas dépasser 40 caractères.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Le nom doit contenir uniquement des lettres minuscules, chiffres et tirets.",
    ),
})

type AgentCreatedSite = {
  id: string
  name: string
  containerName: string
  image: string
  state: string
  running: boolean
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>
  },
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { response: roleError } = requireAdmin(session)
    if (roleError) return roleError

    const { id } = await context.params

    const result = await getAgentSiteStatuses(id)

    return NextResponse.json(result)
  } catch (error) {
    return apiErrorResponse(
      error,
      "GET /api/servers/[id]/sites error:",
      "Impossible de récupérer les sites.",
    )
  }
}

/*
 * Route legacy conservée volontairement (pas de duplication du chemin
 * de création pour un utilisateur normal : celui-ci passe exclusivement
 * par POST /api/sites, qui sélectionne automatiquement un serveur
 * disponible). Cette route reste utile pour un admin qui veut cibler
 * explicitement un serveur précis (ex. valider un serveur fraîchement
 * enrôlé) — c'est la seule différence fonctionnelle avec /api/sites.
 * Comme /api/sites, le tenant du site créé est toujours le créateur
 * lui-même (session.user_id), jamais une valeur fournie par le client.
 */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string }>
  },
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { response: roleError } = requireAdmin(session)
    if (roleError) return roleError

    const { id: serverId } = await context.params

    const body = await request.json().catch(() => null)

    const parsed = createSiteSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Données invalides.",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const { name } = parsed.data

    /*
     * Vérification du serveur
     */
    const serverResult = await query<{
      id: string
      name: string
      hostname: string
      status: string
    }>(
      `
        SELECT
          id,
          name,
          hostname,
          status
        FROM servers
        WHERE id = $1
        LIMIT 1
      `,
      [serverId],
    )

    if (serverResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Serveur introuvable.",
        },
        { status: 404 },
      )
    }

    const server = serverResult.rows[0]

    /*
     * On vérifie que l'Agent répond réellement,
     * plutôt que de se fier à la colonne `status`
     * qui peut être obsolète.
     */
    try {
      await getAgentHealth(serverId)
    } catch {
      return NextResponse.json(
        {
          status: "error",
          message: "L'Agent de ce serveur est injoignable.",
        },
        { status: 503 },
      )
    }

    /*
     * Vérification du nom
     */
    const existingSite = await query<{ id: string }>(
      `
        SELECT id
        FROM sites
        WHERE name = $1
        LIMIT 1
      `,
      [name],
    )

    if (existingSite.rows.length > 0) {
      return NextResponse.json(
        {
          status: "error",
          message: `Le site "${name}" existe déjà.`,
        },
        { status: 409 },
      )
    }

    /*
     * Création réelle du container
     * sur le serveur choisi.
     */
    const agentResponse = await createAgentSite(
      serverId,
      { name, tenantId: session.user_id },
    )

    const agentSite = agentResponse.site as
      | AgentCreatedSite
      | undefined

    if (!agentSite) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "L'Agent n'a pas retourné les informations du site.",
        },
        { status: 502 },
      )
    }

    const userId = session.user_id

    /*
     * Enregistrement du site
     * dans PostgreSQL.
     */
    const siteResult = await query<{
      id: string
      name: string
      container_name: string
      container_id: string | null
      image: string
      status: string
      created_at: string
      server_id: string
    }>(
      `
        INSERT INTO sites (
          user_id,
          server_id,
          name,
          container_name,
          container_id,
          image,
          status
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7
        )
        RETURNING
          id,
          name,
          container_name,
          container_id,
          image,
          status,
          created_at,
          server_id
      `,
      [
        userId,
        serverId,
        name,
        agentSite.containerName,
        agentSite.id,
        agentSite.image,
        agentSite.running
          ? "online"
          : "stopped",
      ],
    )

    const site = siteResult.rows[0]

    /*
     * Création du domaine local
     * pour notre environnement de développement.
     */
    await query(
      `
        INSERT INTO domains (
          site_id,
          domain,
          is_primary
        )
        VALUES (
          $1,
          $2,
          true
        )
        ON CONFLICT DO NOTHING
      `,
      [
        site.id,
        `${name}.localhost`,
      ],
    )

    return NextResponse.json(
      {
        status: "ok",
        message: "Site créé avec succès.",
        site,
        server: {
          id: server.id,
          name: server.name,
          hostname: server.hostname,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    return apiErrorResponse(
      error,
      "POST /api/servers/[id]/sites error:",
      "Impossible de créer le site.",
    )
  }
}