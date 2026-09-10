import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth/session"
import { getAgentDockerInfo } from "@/lib/agent/client"

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>
  },
) {
  try {
    const session = await getCurrentSession()

    if (!session) {
      return NextResponse.json(
        {
          status: "error",
          message: "Authentification requise.",
        },
        { status: 401 },
      )
    }

    const { id } = await context.params

    const docker = await getAgentDockerInfo(id)

    return NextResponse.json(docker)
  } catch (error) {
    console.error(
      "GET /api/servers/[id]/docker error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de récupérer les informations Docker.",
      },
      { status: 500 },
    )
  }
}