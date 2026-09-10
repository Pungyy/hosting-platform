import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/guard"
import { getAgentSiteLogs } from "@/lib/agent/client"

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      id: string
      name: string
    }>
  },
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id, name } = await context.params

    const result = await getAgentSiteLogs(
      id,
      name,
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error(
      "GET /api/servers/[id]/sites/[name]/logs error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de récupérer les logs.",
      },
      { status: 500 },
    )
  }
}