import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { downloadAgentDatabaseBackup } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedDatabase } from "@/lib/resources/databases"

type RouteContext = {
  params: Promise<{
    id: string
    backupId: string
  }>
}

type BackupWithDatabase = {
  id: string
  filename: string
  server_id: string
  database_name: string
}

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id, backupId } = await params

    const { response: ownedError } = await getOwnedDatabase(id, session)
    if (ownedError) return ownedError

    const result = await query<BackupWithDatabase>(
      `
        SELECT
          b.id,
          b.filename,
          b.server_id,
          d.name AS database_name
        FROM backups b
        JOIN databases d ON d.id = b.database_id
        WHERE b.id = $1 AND b.database_id = $2
        LIMIT 1
      `,
      [backupId, id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Sauvegarde introuvable.",
        },
        { status: 404 },
      )
    }

    const backup = result.rows[0]

    let agentResponse: {
      ok: boolean
      status: number
      body: ReadableStream<Uint8Array> | null
    }

    try {
      agentResponse = await downloadAgentDatabaseBackup(
        backup.server_id,
        backup.database_name,
        backup.filename,
      )
    } catch (agentError) {
      return apiErrorResponse(
        agentError,
        "GET /api/databases/[id]/backups/[backupId]/download (agent) error:",
        "Impossible de récupérer la sauvegarde.",
        502,
      )
    }

    if (!agentResponse.ok || !agentResponse.body) {
      return NextResponse.json(
        {
          status: "error",
          message: "Sauvegarde introuvable sur l'Agent.",
        },
        { status: agentResponse.status || 502 },
      )
    }

    return new NextResponse(agentResponse.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${backup.filename}"`,
      },
    })
  } catch (error) {
    console.error(
      "GET /api/databases/[id]/backups/[backupId]/download error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer la sauvegarde.",
      },
      { status: 500 },
    )
  }
}
