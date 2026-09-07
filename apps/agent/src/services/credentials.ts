import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const currentDir = dirname(
  fileURLToPath(import.meta.url),
)

const credentialsPath = join(
  currentDir,
  "../../.agent-credentials.json",
)

type AgentCredentials = {
  token: string
}

export function saveAgentToken(
  token: string,
) {
  const credentials: AgentCredentials = {
    token,
  }

  writeFileSync(
    credentialsPath,
    JSON.stringify(
      credentials,
      null,
      2,
    ),
    {
      encoding: "utf-8",
      mode: 0o600,
    },
  )
}

export function getAgentToken():
  | string
  | null {
  if (
    !existsSync(
      credentialsPath,
    )
  ) {
    return null
  }

  try {
    const content =
      readFileSync(
        credentialsPath,
        "utf-8",
      )

    const credentials =
      JSON.parse(
        content,
      ) as AgentCredentials

    if (
      !credentials.token
    ) {
      return null
    }

    return credentials.token
  } catch {
    return null
  }
}