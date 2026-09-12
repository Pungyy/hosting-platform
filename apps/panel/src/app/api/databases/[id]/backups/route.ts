import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { createAgentDatabaseBackup } from "@/lib/agent/client"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

type DatabaseConfig = {
  id: string
  name: string
  server_id: string
}

type BackupRow = {
  id: string
  database_id: string
  filename: string
  size_bytes: string | null
  status: string
  error_message: string | null
  created_at: string
}

/*
 * GET /api/databases/[id]/backups
 *
 * Historique des sauvegardes de cette base — lecture pure, comme
 * /api/sites/[id]/deployments (pas d'appel Agent).
 */
export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const result = await query<BackupRow>(
      `
        SELECT
          id,
          database_id,
          filename,
          size_bytes,
          status,
          error_message,
          created_at
        FROM backups
        WHERE database_id = $1
        ORDER BY created_at DESC
      `,
      [id],
    )

    return NextResponse.json({
      status: "ok",
      backups: result.rows,
    })
  } catch (error) {
    console.error(
      "GET /api/databases/[id]/backups error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer les sauvegardes.",
      },
      { status: 500 },
    )
  }
}

/*
 * POST /api/databases/[id]/backups
 *
 * Déclenche un vrai pg_dump sur l'Agent. Synchrone (comme le
 * déploiement) : la requête attend la fin du dump.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext,
) {
  let backupId: string | null = null

  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const databaseResult = await query<DatabaseConfig>(
      `
        SELECT id, name, server_id
        FROM databases
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (databaseResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Base de données introuvable.",
        },
        { status: 404 },
      )
    }

    const database = databaseResult.rows[0]

    const insertResult = await query<{ id: string }>(
      `
        INSERT INTO backups (database_id, server_id, filename, status)
        VALUES ($1, $2, '', 'creating')
        RETURNING id
      `,
      [database.id, database.server_id],
    )

    backupId = insertResult.rows[0].id

    let agentResponse: {
      status?: string
      backup?: { filename: string; sizeBytes: number }
    }

    try {
      agentResponse = await createAgentDatabaseBackup(
        database.server_id,
        database.name,
      )
    } catch (agentError) {
      await query(
        `
          UPDATE backups
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `,
        [
          agentError instanceof Error
            ? agentError.message
            : "L'Agent a refusé la sauvegarde.",
          backupId,
        ],
      )

      return NextResponse.json(
        {
          status: "error",
          message:
            agentError instanceof Error
              ? agentError.message
              : "Impossible de créer la sauvegarde.",
        },
        { status: 502 },
      )
    }

    if (!agentResponse.backup) {
      throw new Error(
        agentResponse.status ??
          "L'Agent n'a retourné aucune sauvegarde.",
      )
    }

    const finalResult = await query<BackupRow>(
      `
        UPDATE backups
        SET
          filename = $1,
          size_bytes = $2,
          status = 'completed'
        WHERE id = $3
        RETURNING
          id,
          database_id,
          filename,
          size_bytes,
          status,
          error_message,
          created_at
      `,
      [
        agentResponse.backup.filename,
        agentResponse.backup.sizeBytes,
        backupId,
      ],
    )

    return NextResponse.json(
      { status: "ok", backup: finalResult.rows[0] },
      { status: 201 },
    )
  } catch (error) {
    console.error("POST /api/databases/[id]/backups error:", error)

    if (backupId) {
      await query(
        `
          UPDATE backups
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `,
        [
          error instanceof Error
            ? error.message
            : "Impossible de créer la sauvegarde.",
          backupId,
        ],
      ).catch(() => {})
    }

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de créer la sauvegarde.",
      },
      { status: 500 },
    )
  }
}
