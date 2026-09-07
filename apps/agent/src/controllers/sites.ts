import { z } from "zod"

import { createSite } from "../services/docker.js"

const createSiteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Le nom doit contenir au moins 3 caractères.")
    .max(40, "Le nom ne peut pas dépasser 40 caractères.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Le nom doit contenir uniquement des lettres minuscules, chiffres et tirets.",
    ),
})

export async function createSiteController(request: Request) {
  const body = await request.json().catch(() => null)

  const result = createSiteSchema.safeParse(body)

  if (!result.success) {
    return {
      response: new Response(
        JSON.stringify({
          status: "error",
          message: "Données invalides",
          errors: result.error.flatten(),
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    }
  }

  try {
    const site = await createSite({
      name: result.data.name,
    })

    return {
      data: {
        status: "ok",
        site,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Impossible de créer le site."

    return {
      response: new Response(
        JSON.stringify({
          status: "error",
          message,
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    }
  }
}