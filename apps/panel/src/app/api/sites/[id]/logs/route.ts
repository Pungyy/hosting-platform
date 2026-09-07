import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type AgentLogsResponse = {
  status?: string
  message?: string
  logs?: string
}

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const AGENT_URL =
      process.env.AGENT_URL

    const AGENT_TOKEN =
      process.env.AGENT_TOKEN

    /*
     * Vérification de la configuration
     * de l'Agent.
     */
    if (
      !AGENT_URL ||
      !AGENT_TOKEN
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Configuration Agent manquante.",
        },
        {
          status: 500,
        },
      )
    }

    const { id } =
      await params

    /*
     * Récupération du site.
     */
    const result =
      await query<{
        id: string
        name: string
      }>(
        `
          SELECT
            id,
            name
          FROM sites
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      )

    if (
      result.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Site introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const site =
      result.rows[0]

    /*
     * Récupération des logs
     * auprès de l'Agent.
     */
    const response =
      await fetch(
        `${AGENT_URL}/sites/${encodeURIComponent(
          site.name,
        )}/logs`,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${AGENT_TOKEN}`,
          },

          cache: "no-store",
        },
      )

    /*
     * On récupère d'abord le texte.
     *
     * Cela évite qu'une réponse inattendue
     * de l'Agent provoque une erreur JSON.
     */
    const responseText =
      await response.text()

    let data:
      AgentLogsResponse =
      {}

    if (responseText) {
      try {
        data =
          JSON.parse(
            responseText,
          )
      } catch {
        /*
         * L'Agent a retourné quelque chose
         * qui n'est pas du JSON.
         */
        if (!response.ok) {
          return NextResponse.json(
            {
              status: "error",
              message:
                "L'Agent a retourné une réponse invalide.",
            },
            {
              status: 502,
            },
          )
        }

        return NextResponse.json(
          {
            status: "error",
            message:
              "Réponse invalide de l'Agent.",
          },
          {
            status: 502,
          },
        )
      }
    }

    /*
     * Gestion des erreurs Agent.
     */
    if (!response.ok) {
      /*
       * Un container peut être momentanément
       * indisponible pendant un déploiement.
       *
       * On retourne une réponse JSON propre
       * au frontend.
       */
      if (
        response.status === 404
      ) {
        return NextResponse.json(
          {
            status: "error",
            message:
              data.message ??
              "Le container du site est introuvable.",
          },
          {
            status: 404,
          },
        )
      }

      if (
        response.status === 409
      ) {
        return NextResponse.json(
          {
            status: "error",
            message:
              data.message ??
              "Les logs sont temporairement indisponibles pendant le déploiement.",
            retryable: true,
          },
          {
            status: 409,
          },
        )
      }

      return NextResponse.json(
        {
          status: "error",
          message:
            data.message ??
            "Impossible de récupérer les logs.",
        },
        {
          status:
            response.status >= 400 &&
            response.status < 600
              ? response.status
              : 502,
        },
      )
    }

    /*
     * Réponse normale.
     */
    return NextResponse.json({
      status: "ok",
      logs:
        data.logs ?? "",
    })
  } catch (error) {
    console.error(
      "GET /api/sites/[id]/logs error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de récupérer les logs.",
      },
      {
        status: 500,
      },
    )
  }
}