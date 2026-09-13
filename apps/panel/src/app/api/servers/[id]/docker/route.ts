import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/guard"
import { requireAdmin } from "@/lib/auth/roles"
import { getAgentDockerInfo } from "@/lib/agent/client"

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>
  },
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { response: roleError } = requireAdmin(session)
    if (roleError) return roleError

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
