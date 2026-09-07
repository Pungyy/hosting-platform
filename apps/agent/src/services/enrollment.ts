import { saveAgentToken } from "./credentials.js"

type EnrollmentResponse = {
  status: "ok"
  server: {
    id: string
    name: string
    hostname: string
    status: string
    agentVersion: string | null
    enrolledAt: string
    lastSeenAt: string
  }
  authentication: {
    token: string
  }
}

export async function enrollAgent(
  panelUrl: string,
  enrollmentToken: string,
  hostname: string,
  agentVersion: string,
) {
  const response = await fetch(
    `${panelUrl}/api/servers/enroll`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        token: enrollmentToken,
        hostname,
        agentVersion,
      }),
    },
  )

  const data =
    (await response.json()) as
      | EnrollmentResponse
      | {
          status: "error"
          message: string
        }

  if (!response.ok) {
    throw new Error(
      "message" in data
        ? data.message
        : "Impossible d'enrôler l'Agent.",
    )
  }

  if (
    data.status !== "ok" ||
    !data.authentication?.token
  ) {
    throw new Error(
      "Réponse d'enrôlement invalide.",
    )
  }

  /*
   * On sauvegarde uniquement le token
   * permanent côté Agent.
   */
  saveAgentToken(
    data.authentication.token,
  )

  return data.server
}