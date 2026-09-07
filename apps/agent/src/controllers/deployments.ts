import { z } from "zod"

import {
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