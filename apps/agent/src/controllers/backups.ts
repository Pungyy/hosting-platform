import { z } from "zod"

import {
  BackupTimeoutError,
  MAX_BACKUP_TIMEOUT_MS,
  MIN_BACKUP_TIMEOUT_MS,
  createBackup,
} from "../services/backup.js"

/*
 * Contrairement à buildDeploymentSchema (finding H1), TOUS les champs
 * du corps sont optionnels ici — la seule information "requise"
 * (databaseName) provient du paramètre d'URL, transmis séparément par
 * l'appelant (voir index.ts). Un appelant qui n'envoie aucun corps du
 * tout (rétrocompat) doit rester accepté.
 */
const createBackupSchema = z.object({
  /*
   * Finding M2 ("timeout pg_dump") : le Panel transmet le budget total
   * qu'il a lui-même autorisé (voir AGENT_BACKUP_TIMEOUT_MS côté
   * Panel). Optionnel (rétrocompat), mais toujours borné ici —
   * l'Agent ne fait confiance à AUCUNE valeur reçue du Panel au-delà
   * de ces bornes, quelle que soit son origine.
   */
  backupTimeoutMs: z
    .number()
    .int()
    .min(MIN_BACKUP_TIMEOUT_MS)
    .max(MAX_BACKUP_TIMEOUT_MS)
    .optional(),
})

export async function createBackupController(
  request: Request,
  databaseName: string,
) {
  const body = await request.json().catch(() => ({}))

  const parsed = createBackupSchema.safeParse(body ?? {})

  if (!parsed.success) {
    return {
      response: new Response(
        JSON.stringify({
          status: "error",
          message: "Paramètres de sauvegarde invalides.",
          errors: parsed.error.flatten(),
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    }
  }

  try {
    const backup = await createBackup(
      databaseName,
      parsed.data.backupTimeoutMs,
    )

    return {
      data: {
        status: "ok",
        backup,
      },
    }
  } catch (error) {
    console.error(
      "POST /databases/:name/backups error:",
      error,
    )

    /*
     * Signal explicite (`timeout: true`) plutôt qu'un texte à
     * interpréter — même mécanisme que buildDeploymentController
     * (finding H1). 504 : l'Agent a bien répondu, mais pg_dump a
     * dépassé son délai — distinct d'un 500 (échec pg_dump réel).
     */
    if (error instanceof BackupTimeoutError) {
      return {
        response: new Response(
          JSON.stringify({
            status: "error",
            message: error.message,
            timeout: true,
          }),
          {
            status: 504,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      }
    }

    return {
      response: new Response(
        JSON.stringify({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de créer la sauvegarde.",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    }
  }
}
