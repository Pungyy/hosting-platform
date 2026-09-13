import "dotenv/config"

const agentToken = process.env.AGENT_TOKEN

if (!agentToken) {
  throw new Error(
    "AGENT_TOKEN est obligatoire. Configurez-le dans le fichier .env.",
  )
}

if (agentToken.length < 32) {
  throw new Error(
    "AGENT_TOKEN doit contenir au moins 32 caractères.",
  )
}

/*
 * Secret dédié et distinct d'AGENT_TOKEN, utilisé UNIQUEMENT par
 * Traefik pour authentifier ses appels à GET /traefik/config — voir
 * middleware/auth.ts:requireTraefikToken(). AGENT_TOKEN reste réservé
 * à l'amorçage avant enrôlement (cf. requireAgentToken()) ; une fois
 * un Agent enrôlé, AGENT_TOKEN n'est plus accepté sur aucune route,
 * y compris /traefik/config. Sans un secret séparé pour Traefik (qui
 * n'a pas de notion de "token permanent"), il perdrait alors
 * définitivement l'accès à sa configuration dynamique.
 */
const traefikToken = process.env.TRAEFIK_TOKEN

if (!traefikToken) {
  throw new Error(
    "TRAEFIK_TOKEN est obligatoire. Configurez-le dans le fichier .env.",
  )
}

if (traefikToken.length < 32) {
  throw new Error(
    "TRAEFIK_TOKEN doit contenir au moins 32 caractères.",
  )
}

export const config = {
  port: 4000,

  agentToken,

  traefikToken,

  dockerNetwork: "hosting-sites",

  proxyNetwork: "hosting-proxy",
}