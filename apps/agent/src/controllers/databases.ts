import { z } from "zod"

import { createDatabase } from "../services/database.js"

const createDatabaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Le nom doit contenir au moins 3 caractères.")
    .max(40, "Le nom ne peut pas dépasser 40 caractères.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Le nom doit contenir uniquement des lettres minuscules, chiffres et tirets.",
    ),

  engine: z.enum(["postgres"]),
})

export async function createDatabaseController(request: Request) {
  const body = await request.json().catch(() => null)

  const result = createDatabaseSchema.safeParse(body)

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
    const database = await createDatabase({
      name: result.data.name,
      engine: result.data.engine,
    })

    return {
      data: {
        status: "ok",
        database,
      },
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Impossible de créer la base de données."

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
