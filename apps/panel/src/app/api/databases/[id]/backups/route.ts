import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { createAgentDatabaseBackup } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedDatabase } from "@/lib/resources/databases"

type RouteContext = {
  params: Promise<{
    id: string
  }>
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
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { response: ownedError } = await getOwnedDatabase(id, session)
    if (ownedError) return ownedError

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
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { database, response: ownedError } = await getOwnedDatabase(
      id,
      session,
    )
    if (ownedError) return ownedError

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

      return apiErrorResponse(
        agentError,
        "POST /api/databases/[id]/backups (agent) error:",
        "Impossible de créer la sauvegarde.",
        502,
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

    return apiErrorResponse(
      error,
      "POST /api/databases/[id]/backups error:",
      "Impossible de créer la sauvegarde.",
    )
  }
}
