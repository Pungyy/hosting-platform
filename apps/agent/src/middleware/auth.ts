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

  const permanentToken =
    getAgentToken()

  /*
   * Une fois l'Agent enrôlé (token permanent local présent), ce
   * token devient la SEULE source de vérité : le token statique
   * AGENT_TOKEN n'est plus accepté, même s'il correspond à la
   * valeur configurée dans .env. Sans cette exclusivité, un
   * AGENT_TOKEN compromis (valeur souvent partagée entre
   * plusieurs agents en développement) resterait une porte
   * d'accès permanente sur un agent déjà enrôlé.
   */
  if (permanentToken) {
    if (token === permanentToken) {
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

  /*
   * Pas encore enrôlé (aucun token permanent local) : AGENT_TOKEN
   * ne sert que d'amorçage, ex. environnement de développement
   * local avant tout enrôlement formel.
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