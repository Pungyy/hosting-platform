import { z } from "zod"

import {
  DeploymentTimeoutError,
  MAX_DEPLOYMENT_TIMEOUT_MS,
  MIN_DEPLOYMENT_TIMEOUT_MS,
  deployDeployment,
} from "../services/deployment.js"

const buildDeploymentSchema =
  z.object({
    siteName: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      ),

    repositoryUrl: z
      .string()
      .url(),

    branch: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(
        /^[A-Za-z0-9._/-]+$/,
      ),

    tenantId: z
      .string()
      .trim()
      .uuid("tenantId doit être un UUID valide."),

    /*
     * Finding H1 (correction "invariant 8 min / 15 min") : le Panel
     * transmet le budget total qu'il a lui-même autorisé (voir
     * AGENT_DEPLOYMENT_TIMEOUT_MS côté Panel). Optionnel (rétrocompat
     * avec un appelant qui ne l'enverrait pas), mais toujours borné
     * ici — l'Agent ne fait confiance à AUCUNE valeur reçue du Panel
     * au-delà de ces bornes, quelle que soit son origine.
     */
    deploymentTimeoutMs: z
      .number()
      .int()
      .min(MIN_DEPLOYMENT_TIMEOUT_MS)
      .max(MAX_DEPLOYMENT_TIMEOUT_MS)
      .optional(),
  })

export async function buildDeploymentController(
  request: Request,
) {
  const body =
    await request
      .json()
      .catch(() => null)

  const parsed =
    buildDeploymentSchema.safeParse(
      body,
    )

  if (!parsed.success) {
    return {
      response: new Response(
        JSON.stringify({
          status: "error",
          message:
            "Données de déploiement invalides.",
          errors:
            parsed.error.flatten(),
        }),
        {
          status: 400,
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      ),
    }
  }

  try {
    const result =
      await deployDeployment({
        siteName:
          parsed.data.siteName,
        repositoryUrl:
          parsed.data.repositoryUrl,
        branch:
          parsed.data.branch,
        tenantId:
          parsed.data.tenantId,
        deploymentTimeoutMs:
          parsed.data.deploymentTimeoutMs,
      })

    return {
      data: {
        status: "ok",
        deployment: result,
      },
    }
  } catch (error) {
    console.error(
      "Build deployment error:",
      error,
    )

    /*
     * Signal explicite (`timeout: true`) plutôt qu'un texte à
     * interpréter — voir lib/agent/client.ts:AgentRequestError côté
     * Panel, qui s'en sert pour marquer le deployment 'cancelled' au
     * lieu de 'failed'. 504 (Gateway Timeout) : l'Agent a bien
     * répondu, mais l'opération en aval (le build) a dépassé son
     * délai — distinct d'un 500 (échec de build réel).
     */
    if (
      error instanceof
      DeploymentTimeoutError
    ) {
      return {
        response: new Response(
          JSON.stringify({
            status: "error",
            message: error.message,
            timeout: true,
          }),
          {
            status: 504,
            headers: {
              "Content-Type":
                "application/json",
            },
          },
        ),
      }
    }

    return {
      response: new Response(
        JSON.stringify({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de construire l'image Docker.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      ),
    }
  }
}