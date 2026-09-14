import { NextResponse } from "next/server"

import { AgentRequestError, deployAgentSite } from "@/lib/agent/client"
import { requireSession } from "@/lib/auth/guard"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import {
  acquireDeploymentLock,
  acquireTenantDeploymentSlot,
  markDeploymentSuccess,
  markDeploymentTerminal,
  releaseTenantDeploymentSlot,
} from "@/lib/resources/deployments"
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

  /*
   * Finding M3-2 (audit sécurité) — suit le tenant pour lequel un slot
   * de concurrence a été réservé, afin que le catch englobant puisse
   * le libérer sur toute erreur inattendue. Remis à `null` dès qu'une
   * libération explicite a eu lieu (succès OU échec Agent), pour ne
   * jamais libérer deux fois le même slot — voir
   * lib/resources/deployments.ts pour le raisonnement complet sur ce
   * risque de double décrément.
   */
  let tenantSlotUserId: string | null = null

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
     * Verrou : un seul déploiement 'running' à la fois par site
     * (finding H1 — voir lib/resources/deployments.ts pour le
     * mécanisme complet, basé sur un index unique Postgres, pas une
     * simple vérification applicative).
     */
    const lock = await acquireDeploymentLock(site.id, site.user_id, branch)
    if (lock.response) return lock.response

    deploymentId = lock.deploymentId

    /*
     * Finding M3-2 — plafond de déploiements 'running' SIMULTANÉS par
     * tenant (en plus du verrou H1 ci-dessus, qui n'a aucune portée
     * cross-site). Acquis APRÈS le verrou H1, jamais avant : un site
     * déjà en cours de déploiement doit renvoyer son 409 propre sans
     * jamais consommer un slot tenant pour un déploiement qui n'aurait
     * de toute façon pas pu démarrer.
     *
     * Si le tenant est déjà à sa limite, ce deployment ne doit JAMAIS
     * rester 'running' : on le termine immédiatement (CAS, comme tout
     * autre passage à l'état terminal) avant de répondre, sans jamais
     * appeler l'Agent ni Docker.
     */
    const slot = await acquireTenantDeploymentSlot(site.user_id)
    if (slot.response) {
      await markDeploymentTerminal(
        deploymentId,
        "failed",
        "\n\nDéploiement refusé : limite de déploiements simultanés atteinte pour cet utilisateur.",
      ).catch((databaseError) => {
        console.error(
          "POST /api/sites/[id]/deploy — impossible de terminer le deployment refusé pour quota tenant :",
          databaseError,
        )
      })

      return slot.response
    }

    tenantSlotUserId = site.user_id

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
     * Enregistrement du résultat du déploiement — CAS explicite
     * (finding H1, correction "statut écrasable") : n'écrit 'success'
     * que si la ligne est ENCORE 'running'. Si une autre requête l'a
     * déjà réclamée comme 'failed' (délai de sécurité dépassé pendant
     * que cet appel Agent était en cours), on ne l'écrase jamais
     * silencieusement.
     */
    const successResult =
      await markDeploymentSuccess(
        deploymentId,
        {
          commitSha: deployment.commitSha ?? null,
          logs,
          imageName: deployment.imageName ?? null,
          imageId: deployment.imageId ?? null,
          containerName: deployment.container?.name ?? null,
          containerId: deployment.container?.id ?? null,
        },
      )

    /*
     * Libération du slot tenant (finding M3-2) — UNIQUEMENT si CETTE
     * requête a réellement effectué la transition (`applied`). Si
     * `applied` est faux, une réclamation de verrou orphelin
     * (reclaimStaleDeployments) a déjà marqué ce deployment 'failed'
     * ET déjà libéré son slot pendant que cet appel Agent était encore
     * en cours — libérer une seconde fois ici décrémenterait à tort le
     * compteur d'un AUTRE déploiement du même tenant, réellement en
     * cours.
     */
    if (successResult.applied && tenantSlotUserId) {
      await releaseTenantDeploymentSlot(tenantSlotUserId).catch(
        (releaseError) => {
          console.error(
            "POST /api/sites/[id]/deploy — libération du slot tenant impossible :",
            releaseError,
          )
        },
      )
      tenantSlotUserId = null
    }

    /*
     * Synchronisation des informations du site — reflète l'état réel
     * de Docker (le container a bien été remplacé par l'Agent),
     * indépendamment de l'issue du CAS ci-dessus sur la ligne de
     * bookkeeping deployments.
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

    if (!successResult.applied) {
      /*
       * Le déploiement a réellement réussi côté Agent (le site est à
       * jour, cf. synchronisation ci-dessus), mais son suivi a expiré
       * côté Panel avant de pouvoir enregistrer ce succès — jamais un
       * "ok" silencieux qui contredirait ce qui est réellement en base.
       */
      return NextResponse.json(
        {
          status: "error",
          message:
            "Le déploiement a été appliqué avec succès sur le serveur, mais son suivi a expiré côté Panel avant l'enregistrement final (délai de sécurité dépassé). Le site a été mis à jour ; vérifiez son état actuel.",
          deployment: {
            id: deploymentId,
            ...deployment,
          },
        },
        { status: 409 },
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
     * Si le deployment existe déjà, on le marque comme terminé —
     * 'cancelled' si l'Agent a explicitement signalé une annulation
     * pour dépassement du délai de sécurité côté build (finding H1,
     * voir apps/agent/src/services/deployment.ts), 'failed' sinon.
     * Dans les deux cas, le verrou (index unique partiel) est libéré.
     */
    if (deploymentId) {
      const isAgentTimeout =
        error instanceof AgentRequestError &&
        error.data.timeout === true

      const terminalResult = await markDeploymentTerminal(
        deploymentId,
        isAgentTimeout ? "cancelled" : "failed",
        `\n\nErreur: ${
          error instanceof Error
            ? error.message
            : "Erreur inconnue."
        }`,
      ).catch(
        (databaseError) => {
          console.error(
            "Impossible de mettre à jour le deployment en échec:",
            databaseError,
          )

          return undefined
        },
      )

      /*
       * Finding M3-2 — libère le slot tenant UNIQUEMENT si (a) cette
       * requête en détenait bien un (tenantSlotUserId non nul — jamais
       * le cas si l'erreur est survenue AVANT l'acquisition du slot,
       * ex. verrou H1 refusé ou site invalide) ET (b) CETTE requête a
       * réellement effectué la transition terminale (`applied` vrai,
       * confirmé — pas juste "pas d'exception"). Si markDeploymentTerminal
       * a échoué (terminalResult undefined) ou a été devancée par une
       * réclamation de verrou orphelin (`applied` faux), on NE libère
       * PAS : un slot temporairement perdu (fail-closed) est acceptable,
       * un double décrément ou un dépassement de la limite ne le sont
       * jamais.
       */
      if (tenantSlotUserId && terminalResult?.applied) {
        await releaseTenantDeploymentSlot(tenantSlotUserId).catch(
          (releaseError) => {
            console.error(
              "POST /api/sites/[id]/deploy — libération du slot tenant impossible :",
              releaseError,
            )
          },
        )
        tenantSlotUserId = null
      }
    }

    return apiErrorResponse(
      error,
      "POST /api/sites/[id]/deploy error:",
      "Le déploiement a échoué.",
    )
  }
}