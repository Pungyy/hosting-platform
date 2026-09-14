import { NextResponse } from "next/server"

import { deployAgentSite } from "@/lib/agent/client"
import { requireSession } from "@/lib/auth/guard"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedSite } from "@/lib/resources/sites"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type DeploymentResponse = {
  status?: string
  message?: string
  deployment?: {
    deploymentId?: string
    commitSha?: string
    imageName?: string
    imageId?: string
    logs?: string
    container?: {
      name?: string
      id?: string
      running?: boolean
    }
    build?: {
      logs?: string
    }
  }
}

export async function POST(
  _request: Request,
  { params }: RouteContext,
) {
  let deploymentId: string | null = null

  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { site, response: ownedError } = await getOwnedSite(id, session)
    if (ownedError) return ownedError

    /*
     * Vérification de la configuration GitHub.
     */
    if (!site.repository_url) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Aucun repository GitHub n'est configuré pour ce site.",
        },
        {
          status: 400,
        },
      )
    }

    const branch =
      site.repository_branch?.trim() ||
      "main"

    /*
     * Création du deployment en base.
     */
    const deploymentResult =
      await query<{
        id: string
      }>(
        `
          INSERT INTO deployments (
            site_id,
            branch,
            status,
            started_at
          )
          VALUES (
            $1,
            $2,
            'running',
            NOW()
          )
          RETURNING id
        `,
        [
          site.id,
          branch,
        ],
      )

    deploymentId =
      deploymentResult.rows[0].id

    /*
     * Déploiement sur l'Agent du serveur
     * associé au site.
     */
    const agentResponse =
      await deployAgentSite(
        site.server_id,
        {
          siteName: site.name,
          repositoryUrl:
            site.repository_url,
          branch,
          tenantId: site.user_id,
        },
      ) as DeploymentResponse

    const deployment =
      agentResponse.deployment

    if (
      !deployment
    ) {
      throw new Error(
        agentResponse.message ??
          "L'Agent n'a retourné aucun résultat de déploiement.",
      )
    }

    const logs =
      deployment.logs ??
      ""
    /*
     * Enregistrement du résultat du déploiement.
     */
    await query(
      `
        UPDATE deployments
        SET
          commit_sha = $1,
          status = 'success',
          finished_at = NOW(),
          logs = $2,
          image_name = $3,
          image_id = $4,
          container_name = $5,
          container_id = $6
        WHERE id = $7
      `,
      [
        deployment.commitSha ??
          null,

        logs,

        deployment.imageName ??
          null,

        deployment.imageId ??
          null,

        deployment.container?.name ??
          null,

        deployment.container?.id ??
          null,

        deploymentId,
      ],
    )

    /*
     * Synchronisation des informations du site.
     */
    if (
      deployment.container?.name ||
      deployment.container?.id ||
      deployment.imageName
    ) {
      await query(
        `
          UPDATE sites
          SET
            container_name = COALESCE($1, container_name),
            container_id = COALESCE($2, container_id),
            image = COALESCE($3, image),
            status = $4,
            updated_at = NOW()
          WHERE id = $5
        `,
        [
          deployment.container?.name ??
            null,

          deployment.container?.id ??
            null,

          deployment.imageName ??
            null,

          deployment.container?.running
            ? "online"
            : "stopped",

          site.id,
        ],
      )
    }

    return NextResponse.json({
      status: "ok",
      deployment: {
        id: deploymentId,
        ...deployment,
      },
    })
  } catch (error) {
    /*
     * Si le deployment existe déjà,
     * on le marque comme failed.
     */
    if (deploymentId) {
      await query(
        `
          UPDATE deployments
          SET
            status = 'failed',
            finished_at = NOW(),
            logs = COALESCE(logs, '') || $1
          WHERE id = $2
        `,
        [
          `\n\nErreur: ${
            error instanceof Error
              ? error.message
              : "Erreur inconnue."
          }`,

          deploymentId,
        ],
      ).catch(
        (databaseError) => {
          console.error(
            "Impossible de mettre à jour le deployment en échec:",
            databaseError,
          )
        },
      )
    }

    return apiErrorResponse(
      error,
      "POST /api/sites/[id]/deploy error:",
      "Le déploiement a échoué.",
    )
  }
}