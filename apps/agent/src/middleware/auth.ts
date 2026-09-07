import type { Context, Next } from "hono"

import { config } from "../config.js"

export async function requireAgentToken(
  c: Context,
  next: Next,
) {
  const authorization =
    c.req.header("Authorization")

  if (!authorization) {
    return c.json(
      {
        status: "error",
        message:
          "Authentification requise",
      },
      401,
    )
  }

  const [scheme, token] =
    authorization.split(" ")

  if (
    scheme !== "Bearer" ||
    !token
  ) {
    return c.json(
      {
        status: "error",
        message:
          "Format d'authentification invalide",
      },
      401,
    )
  }

  /*
   * Authentification locale actuelle.
   *
   * Ce token sera conservé pour notre
   * environnement de développement local.
   */
  if (
    token === config.agentToken
  ) {
    await next()
    return
  }

  return c.json(
    {
      status: "error",
      message: "Token invalide",
    },
    401,
  )
}