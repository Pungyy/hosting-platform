import "dotenv/config"

import os from "node:os"

import { enrollAgent } from "./services/enrollment.js"

const panelUrl =
  process.env.PANEL_URL ??
  "http://localhost:3001"

const agentUrl =
  process.env.AGENT_URL

const enrollmentToken =
  process.env.ENROLLMENT_TOKEN

const hostname =
  process.env.AGENT_HOSTNAME ??
  os.hostname()

const agentVersion =
  "0.1.0"

async function main() {
  if (!enrollmentToken) {
    throw new Error(
      "ENROLLMENT_TOKEN est obligatoire.",
    )
  }

  if (!agentUrl) {
    throw new Error(
      "AGENT_URL est obligatoire.",
    )
  }

  console.log(
    "Enrôlement de l'Agent...",
  )

  console.log(
    `Panel : ${panelUrl}`,
  )

  console.log(
    `Agent : ${agentUrl}`,
  )

  console.log(
    `Hostname : ${hostname}`,
  )

  const server =
    await enrollAgent(
      panelUrl,
      enrollmentToken,
      hostname,
      agentVersion,
      agentUrl,
    )

  console.log("")

  console.log(
    "✅ Agent enrôlé avec succès.",
  )

  console.log(
    `Serveur : ${server.name}`,
  )

  console.log(
    `ID : ${server.id}`,
  )

  console.log(
    `Hostname : ${server.hostname}`,
  )

  console.log(
    `Statut : ${server.status}`,
  )

  console.log("")

  console.log(
    "🔐 Le token permanent a été sauvegardé localement.",
  )
}

main().catch((error) => {
  console.error("")

  console.error(
    "❌ Échec de l'enrôlement.",
  )

  console.error(
    error instanceof Error
      ? error.message
      : error,
  )

  process.exit(1)
})