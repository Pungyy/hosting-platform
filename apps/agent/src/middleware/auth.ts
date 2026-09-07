import type { Context, Next } from "hono"

import { config } from "../config.js"
import { getAgentToken } from "../services/credentials.js"

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
        message: "Authentification requise",
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
   * Le token permanent généré lors de
   * l'enrôlement est prioritaire.
   */
  const permanentToken =
    getAgentToken()

  if (
    permanentToken &&
    token === permanentToken
  ) {
    await next()
    return
  }

  /*
   * Fallback pour notre environnement
   * de développement local.
   *
   * Il permet de continuer à utiliser
   * AGENT_TOKEN tant que l'Agent n'est
   * pas encore enrôlé.
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