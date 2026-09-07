import { NextResponse } from "next/server"

const AGENT_URL = "http://localhost:4000"

export async function GET() {
  try {
    const response = await fetch(`${AGENT_URL}/health`, {
      cache: "no-store",
    })

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "offline",
          message: "L'Agent a répondu avec une erreur",
        },
        { status: 502 },
      )
    }

    const data = await response.json()

    return NextResponse.json({
      status: "online",
      agent: data,
    })
  } catch {
    return NextResponse.json(
      {
        status: "offline",
        message: "Impossible de contacter l'Agent",
      },
      { status: 503 },
    )
  }
}