import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth/session"
import { agentSiteAction } from "@/lib/agent/client"

const allowedActions = [
  "start",
  "stop",
  "restart",
] as const

type SiteAction = (typeof allowedActions)[number]

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      id: string
      name: string
    }>
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

    const { id, name } = await context.params

    const body = await request
      .json()
      .catch(() => null)

    const action = body?.action

    if (
      typeof action !== "string" ||
      !allowedActions.includes(
        action as SiteAction,
      )
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Action invalide. Actions autorisées : start, stop, restart.",
        },
        { status: 400 },
      )
    }

    const result = await agentSiteAction(
      id,
      name,
      action,
    )

    return NextResponse.json(result)
  } catch (error) {
    console.error(
      "POST /api/servers/[id]/sites/[name]/action error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible d'exécuter l'action.",
      },
      { status: 500 },
    )
  }
}