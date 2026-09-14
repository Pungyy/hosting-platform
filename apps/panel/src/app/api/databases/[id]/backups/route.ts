import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import {
  AgentRequestError,
  createAgentDatabaseBackup,
  deleteAgentDatabaseBackup,
} from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import {
  acquireBackupLock,
  markBackupFailed,
  markBackupSuccess,
} from "@/lib/resources/backups"
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

    /*
     * Verrou "une seule sauvegarde 'creating' à la fois" + quota de
     * 10 sauvegardes complétées, tous deux vérifiés de façon atomique
     * ici (finding M2 — voir lib/resources/backups.ts pour le
     * mécanisme complet, basé sur un index unique Postgres, pas une
     * simple vérification applicative).
     */
    const lock = await acquireBackupLock(
      database.id,
      database.server_id,
    )
    if (lock.response) return lock.response

    backupId = lock.backupId

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
      /*
       * Signal explicite de timeout (finding M2, même mécanisme que
       * H1) plutôt qu'un message générique — distingue un pg_dump
       * réellement annulé pour dépassement du délai de sécurité d'un
       * échec normal.
       */
      const isAgentTimeout =
        agentError instanceof AgentRequestError &&
        agentError.data.timeout === true

      await markBackupFailed(
        backupId,
        isAgentTimeout
          ? "Sauvegarde annulée : délai de sécurité dépassé côté Agent."
          : agentError instanceof Error
            ? agentError.message
            : "L'Agent a refusé la sauvegarde.",
      ).catch(() => {})

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

    const successResult = await markBackupSuccess(backupId, {
      filename: agentResponse.backup.filename,
      sizeBytes: agentResponse.backup.sizeBytes,
    })

    if (!successResult.applied) {
      /*
       * Le pg_dump a réellement réussi côté Agent (le fichier existe
       * sur son disque), mais son suivi a expiré côté Panel avant de
       * pouvoir l'enregistrer (réclamé comme 'failed' par une autre
       * requête pendant l'attente) — le fichier serait sinon orphelin
       * : invisible dans l'UI, jamais comptabilisé dans le quota,
       * jamais nettoyable manuellement. Nettoyage best-effort côté
       * Agent plutôt que de laisser fuir de l'espace disque en
       * silence (finding M2, le risque même que ce chantier corrige).
       */
      await deleteAgentDatabaseBackup(
        database.server_id,
        database.name,
        agentResponse.backup.filename,
      ).catch(() => {})

      return NextResponse.json(
        {
          status: "error",
          message:
            "La sauvegarde a été créée avec succès sur le serveur, mais son suivi a expiré côté Panel avant l'enregistrement final (délai de sécurité dépassé). Veuillez réessayer.",
        },
        { status: 409 },
      )
    }

    const finalResult = await query<BackupRow>(
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
        WHERE id = $1
      `,
      [backupId],
    )

    return NextResponse.json(
      { status: "ok", backup: finalResult.rows[0] },
      { status: 201 },
    )
  } catch (error) {
    if (backupId) {
      await markBackupFailed(
        backupId,
        error instanceof Error
          ? error.message
          : "Impossible de créer la sauvegarde.",
      ).catch(() => {})
    }

    return apiErrorResponse(
      error,
      "POST /api/databases/[id]/backups error:",
      "Impossible de créer la sauvegarde.",
    )
  }
}
