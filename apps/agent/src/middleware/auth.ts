import { timingSafeEqual } from "node:crypto"

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

/*
 * Comparaison en temps constant, pour ne pas laisser fuiter
 * d'information sur le secret via le temps de réponse. Les deux
 * chaînes doivent faire la même longueur pour timingSafeEqual — une
 * différence de longueur est déjà, en soi, une non-correspondance.
 */
function safeCompare(a: string, b: string) {
  const bufferA = Buffer.from(a, "utf8")
  const bufferB = Buffer.from(b, "utf8")

  if (bufferA.length !== bufferB.length) {
    return false
  }

  return timingSafeEqual(bufferA, bufferB)
}

/*
 * Authentification dédiée à Traefik, qui n'est PAS le Panel : il n'a
 * pas de notion de "token permanent d'Agent" et ne peut structurellement
 * présenter qu'un secret statique, configuré une fois pour toutes dans
 * son propre docker-compose. TRAEFIK_TOKEN est donc un secret à part,
 * indépendant d'AGENT_TOKEN et du token permanent — voir config.ts.
 *
 * Volontairement séparée de requireAgentToken() : cette fonction ne
 * doit accepter QUE TRAEFIK_TOKEN, jamais AGENT_TOKEN ni le token
 * permanent de l'Agent, et n'est câblée que sur GET /traefik/config
 * (jamais sur /sites, /databases, /backups, etc.).
 */
export async function requireTraefikToken(
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

  if (safeCompare(token, config.traefikToken)) {
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