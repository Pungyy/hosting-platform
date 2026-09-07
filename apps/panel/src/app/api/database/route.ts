import { NextResponse } from "next/server"

import { checkDatabaseConnection } from "@/lib/database"

export async function GET() {
  try {
    const result = await checkDatabaseConnection()

    return NextResponse.json({
      status: "ok",
      database: "connected",
      serverTime: result.now,
    })
  } catch (error) {
    console.error("Database connection error:", error)

    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
        message: "Impossible de se connecter à PostgreSQL.",
      },
      {
        status: 503,
      },
    )
  }
}