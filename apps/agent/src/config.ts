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

export const config = {
  port: 4000,

  agentToken,

  dockerNetwork: "hosting-sites",

  proxyNetwork: "hosting-proxy",
}