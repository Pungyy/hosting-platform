import { NextResponse } from "next/server"
import { z } from "zod"

import { query } from "@/lib/database"

const createSiteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(
      3,
      "Le nom doit contenir au moins 3 caractères.",
    )
    .max(
      40,
      "Le nom ne peut pas dépasser 40 caractères.",
    )
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Le nom doit contenir uniquement des lettres minuscules, chiffres et tirets.",
    ),
})

type AgentSiteStatus = {
  name: string | null
  containerId: string
  containerName: string | null
  status: string
  running: boolean
}

type AgentStatusesResponse = {
  status?: string
  message?: string
  sites?: AgentSiteStatus[]
}

/*
 * Récupération des statuts réels depuis l'Agent.
 *
 * Le Panel ne parle jamais directement à Docker.
 * Il passe toujours par l'Agent.
 */
async function getAgentSiteStatuses() {
  const agentUrl =
    process.env.AGENT_URL

  const agentToken =
    process.env.AGENT_TOKEN

  if (!agentUrl || !agentToken) {
    throw new Error(
      "Configuration de l'Agent manquante.",
    )
  }

  const response =
    await fetch(
      `${agentUrl}/sites/statuses`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${agentToken}`,
        },
        cache: "no-store",
      },
    )

  const text =
    await response.text()

  let data: AgentStatusesResponse = {}

  if (text) {
    try {
      data =
        JSON.parse(text)
    } catch {
      throw new Error(
        "Réponse invalide de l'Agent.",
      )
    }
  }

  if (
    !response.ok ||
    data.status !== "ok" ||
    !Array.isArray(data.sites)
  ) {
    throw new Error(
      data.message ??
        "Impossible de récupérer les statuts des sites depuis l'Agent.",
    )
  }

  return data.sites
}

/*
 * GET /api/sites
 *
 * Récupère les sites PostgreSQL puis
 * synchronise leur statut avec Docker.
 */
export async function GET() {
  try {
    /*
     * Récupération des sites en base.
     */
    const result = await query<{
      id: string
      name: string
      container_name: string
      container_id: string | null
      image: string
      status: string
      created_at: string
      server_id: string
    }>(`
      SELECT
        s.id,
        s.name,
        s.container_name,
        s.container_id,
        s.image,
        s.status,
        s.created_at,
        s.server_id
      FROM sites s
      ORDER BY s.created_at DESC
    `)

    const sites =
      result.rows

    /*
     * Récupération des statuts réels
     * depuis Docker via l'Agent.
     */
    let agentSites:
      AgentSiteStatus[] = []

    try {
      agentSites =
        await getAgentSiteStatuses()
    } catch (agentError) {
      /*
       * Si l'Agent est momentanément
       * indisponible, on retourne les données
       * PostgreSQL sans faire échouer toute
       * la page.
       */
      console.error(
        "GET /api/sites - Agent status sync error:",
        agentError,
      )

      return NextResponse.json({
        status: "ok",
        sites,
        sync: {
          status: "unavailable",
          message:
            "Impossible de synchroniser les statuts Docker.",
        },
      })
    }

    /*
     * Création d'un index par nom de site
     * pour éviter de parcourir les tableaux
     * plusieurs fois.
     */
    const agentSitesByName =
      new Map<string, AgentSiteStatus>()

    for (const agentSite of agentSites) {
      if (!agentSite.name) {
        continue
      }

      agentSitesByName.set(
        agentSite.name,
        agentSite,
      )
    }

    /*
     * Synchronisation PostgreSQL → état réel Docker.
     */
    for (const site of sites) {
      const agentSite =
        agentSitesByName.get(
          site.name,
        )

      /*
       * Le container n'existe plus côté Docker.
       *
       * On considère alors le site comme arrêté
       * dans PostgreSQL.
       */
      if (!agentSite) {
        if (site.status !== "stopped") {
          await query(
            `
              UPDATE sites
              SET
                status = 'stopped'
              WHERE id = $1
            `,
            [site.id],
          )

          site.status =
            "stopped"
        }

        continue
      }

      /*
       * Conversion de l'état Docker
       * vers notre état métier.
       *
       * running → online
       * tout autre état → stopped
       */
      const newStatus =
        agentSite.running
          ? "online"
          : "stopped"

      /*
       * On n'effectue une requête UPDATE
       * que si le statut a réellement changé.
       */
      if (
        site.status !== newStatus
      ) {
        await query(
          `
            UPDATE sites
            SET
              status = $1
            WHERE id = $2
          `,
          [
            newStatus,
            site.id,
          ],
        )

        site.status =
          newStatus
      }

      /*
       * On met également à jour le container_id
       * si Docker nous fournit un nouvel ID.
       */
      if (
        site.container_id !==
        agentSite.containerId
      ) {
        await query(
          `
            UPDATE sites
            SET
              container_id = $1
            WHERE id = $2
          `,
          [
            agentSite.containerId,
            site.id,
          ],
        )

        site.container_id =
          agentSite.containerId
      }
    }

    return NextResponse.json({
      status: "ok",
      sites,
      sync: {
        status: "synchronized",
      },
    })
  } catch (error) {
    console.error(
      "GET /api/sites error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de récupérer les sites.",
      },
      {
        status: 500,
      },
    )
  }
}

/*
 * POST /api/sites
 *
 * Création d'un nouveau site.
 */
export async function POST(
  request: Request,
) {
  try {
    /*
     * Vérification du body JSON.
     */
    const body = await request
      .json()
      .catch(() => null)

    /*
     * Validation du nom.
     */
    const result =
      createSiteSchema.safeParse(body)

    if (!result.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Données invalides.",
          errors: result.error.flatten(),
        },
        {
          status: 400,
        },
      )
    }

    const { name } = result.data

    /*
     * Vérification des variables d'environnement.
     */
    const agentUrl =
      process.env.AGENT_URL

    const agentToken =
      process.env.AGENT_TOKEN

    if (!agentUrl || !agentToken) {
      console.error(
        "AGENT_URL ou AGENT_TOKEN manquant.",
      )

      return NextResponse.json(
        {
          status: "error",
          message:
            "Configuration de l'Agent manquante.",
        },
        {
          status: 500,
        },
      )
    }

    /*
     * Vérification qu'un serveur existe.
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
        WHERE status = 'online'
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )

    if (serverResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Aucun serveur disponible.",
        },
        {
          status: 503,
        },
      )
    }

    const server =
      serverResult.rows[0]

    /*
     * Vérification que le nom n'est pas
     * déjà utilisé dans PostgreSQL.
     */
    const existingSite =
      await query<{ id: string }>(
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
          message:
            `Le site "${name}" existe déjà.`,
        },
        {
          status: 409,
        },
      )
    }

    /*
     * Création du site côté Agent.
     *
     * Le Panel ne parle jamais directement
     * à Docker.
     */
    const agentResponse =
      await fetch(
        `${agentUrl}/sites`,
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${agentToken}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            name,
          }),
          cache: "no-store",
        },
      )

    const agentText =
      await agentResponse.text()

    let agentData: {
      status?: string
      message?: string
      site?: {
        id: string
        name: string
        containerName: string
        image: string
        state: string
        running: boolean
      }
    } = {}

    if (agentText) {
      try {
        agentData =
          JSON.parse(agentText)
      } catch {
        console.error(
          "Réponse invalide de l'Agent:",
          agentText,
        )
      }
    }

    if (
      !agentResponse.ok ||
      agentData.status !== "ok" ||
      !agentData.site
    ) {
      console.error(
        "Agent create site error:",
        {
          status:
            agentResponse.status,
          response: agentText,
        },
      )

      return NextResponse.json(
        {
          status: "error",
          message:
            agentData.message ??
            "Impossible de créer le site sur l'Agent.",
        },
        {
          status:
            agentResponse.status >= 400 &&
            agentResponse.status < 600
              ? agentResponse.status
              : 502,
        },
      )
    }

    const agentSite =
      agentData.site

    /*
     * Création de l'utilisateur système
     * local si nécessaire.
     *
     * Cela nous permet de garder le schéma
     * actuel fonctionnel avant la mise en place
     * du véritable système d'authentification.
     */
    const userResult = await query<{
      id: string
    }>(
      `
        SELECT id
        FROM users
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )

    let userId: string

    if (userResult.rows.length > 0) {
      userId =
        userResult.rows[0].id
    } else {
      const newUser =
        await query<{ id: string }>(
          `
            INSERT INTO users (
              email,
              name
            )
            VALUES (
              $1,
              $2
            )
            RETURNING id
          `,
          [
            "admin@hosting.local",
            "Administrator",
          ],
        )

      userId =
        newUser.rows[0].id
    }

    /*
     * Enregistrement du site dans PostgreSQL.
     */
    try {
      const siteResult =
        await query<{
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
            server.id,
            name,
            agentSite.containerName,
            agentSite.id,
            agentSite.image,
            agentSite.running
              ? "online"
              : "stopped",
          ],
        )

      const site =
        siteResult.rows[0]

      /*
       * Création automatique du domaine
       * local de développement.
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
          site,
        },
        {
          status: 201,
        },
      )
    } catch (databaseError) {
      console.error(
        "Database error after Agent site creation:",
        databaseError,
      )

      /*
       * Si PostgreSQL échoue après la création
       * Docker, on tente de nettoyer le container.
       */
      try {
        await fetch(
          `${agentUrl}/sites/${encodeURIComponent(
            name,
          )}`,
          {
            method: "DELETE",
            headers: {
              Authorization:
                `Bearer ${agentToken}`,
            },
            cache: "no-store",
          },
        )
      } catch (cleanupError) {
        console.error(
          "Impossible de nettoyer le site Agent:",
          cleanupError,
        )
      }

      return NextResponse.json(
        {
          status: "error",
          message:
            "Le site Docker a été créé mais son enregistrement en base a échoué.",
        },
        {
          status: 500,
        },
      )
    }
  } catch (error) {
    console.error(
      "POST /api/sites error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de créer le site.",
      },
      {
        status: 500,
      },
    )
  }
}