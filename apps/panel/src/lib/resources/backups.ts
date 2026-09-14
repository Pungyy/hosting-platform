import { NextResponse } from "next/server"

import { AGENT_BACKUP_TIMEOUT_MS } from "@/lib/agent/client"
import { query, type Queryer } from "@/lib/database"

/*
 * Finding M2 (audit sécurité) — verrou "une seule sauvegarde 'creating'
 * par database" à la fois.
 *
 * Le verrou lui-même est l'index unique partiel `backups`
 * (`idx_backups_one_creating_per_database`, migration 012) : c'est
 * Postgres qui garantit l'atomicité de l'ACQUISITION, pas ce module —
 * deux appels concurrents à acquireBackupLock() pour la même
 * database_id ne peuvent jamais tous les deux réussir leur INSERT.
 *
 * Un backup sort de lui-même de cet index dès que son status change
 * (completed/failed). Toutes les transitions terminales passent par un
 * UPDATE ... WHERE status = 'creating' (compare-and-swap) et
 * vérifient rowCount — même leçon que H1 (revue indépendante du
 * commit 2054172, finding "statut final écrasable") appliquée dès la
 * conception ici, plutôt que découverte après coup : si 0 ligne n'a
 * été affectée, c'est qu'une autre requête (réclamation d'un verrou
 * orphelin) a déjà tranché — jamais un écrasement silencieux.
 */

/*
 * Invariant timeout Agent / stale-lock Panel (même construction que
 * STALE_DEPLOYMENT_LOCK_MS, finding H1) : STALE_BACKUP_LOCK_MS DOIT
 * rester strictement supérieur à la durée totale que le Panel a
 * lui-même autorisée à l'Agent pour l'ENSEMBLE de l'opération pg_dump
 * (toutes les tentatives de retry comprises — voir
 * AGENT_BACKUP_TIMEOUT_MS dans lib/agent/client.ts, la valeur
 * littéralement envoyée à l'Agent à chaque appel).
 *
 * DÉRIVÉ arithmétiquement de cette même constante plutôt que choisi
 * comme un second nombre indépendant — il ne peut plus dériver
 * silencieusement, seulement être modifié délibérément au même
 * endroit.
 */
export const RECLAIM_SAFETY_MARGIN_MS = 5 * 60 * 1000

export const STALE_BACKUP_LOCK_MS =
  AGENT_BACKUP_TIMEOUT_MS + RECLAIM_SAFETY_MARGIN_MS

/*
 * Décision produit (validée) : au-delà de 10 sauvegardes COMPLÉTÉES
 * conservées pour une même base, toute nouvelle création est refusée
 * explicitement (409) — jamais de suppression automatique d'un
 * ancien backup. L'utilisateur doit supprimer manuellement une
 * sauvegarde existante avant d'en créer une nouvelle.
 *
 * Porte uniquement sur les backups 'completed' : un backup 'creating'
 * ne compte jamais pour ce quota (voir acquireBackupLock ci-dessous) —
 * et comme au plus UN backup peut être 'creating' à la fois pour une
 * même base (verrou ci-dessus), deux créations concurrentes ne
 * peuvent structurellement jamais faire dépasser ce quota : la
 * vérification et l'acquisition du verrou sont effectuées dans la
 * MÊME fonction, sur la même connexion, avant que quiconque d'autre
 * ne puisse insérer un nouveau 'creating' pour cette base.
 */
export const MAX_COMPLETED_BACKUPS_PER_DATABASE = 10

const BACKUP_LOCK_CONSTRAINT =
  "idx_backups_one_creating_per_database"

function isBackupLockViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const pgError = error as {
    code?: unknown
    constraint?: unknown
  }

  return (
    pgError.code === "23505" &&
    pgError.constraint === BACKUP_LOCK_CONSTRAINT
  )
}

/*
 * Réclamation paresseuse des verrous orphelins (crash/restart du Panel
 * ou de l'Agent avant la mise à jour finale, finding M2 §5) —
 * correctement scopée à CETTE base (`database_id = $1`) : la
 * réclamation d'une base ne touche jamais les backups 'creating'
 * d'une autre base, même orphelins depuis plus longtemps.
 *
 * Le seuil (STALE_BACKUP_LOCK_MS, ~14 min) est strictement supérieur
 * au budget interne de l'Agent (~9 min, voir AGENT_BACKUP_TIMEOUT_MS)
 * + une marge de nettoyage : un pg_dump RÉELLEMENT actif ne peut donc
 * jamais être réclamé à tort par ce mécanisme (finding M2 §5,
 * "vérifie que la réclamation ne peut pas tuer un pg_dump encore
 * réellement actif") — la réclamation ne fait qu'écrire une ligne
 * Postgres, elle n'envoie jamais elle-même de signal à un process ;
 * l'Agent est seul responsable d'arrêter réellement pg_dump via son
 * propre timeout interne (services/backup.ts:createBackup), qui a
 * TOUJOURS déjà expiré avant que ce seuil ne soit atteint.
 */
export async function reclaimStaleBackups(
  databaseId: string,
  db: Queryer = { query },
): Promise<void> {
  const staleThreshold = new Date(
    Date.now() - STALE_BACKUP_LOCK_MS,
  )

  await db.query(
    `
      UPDATE backups
      SET
        status = 'failed',
        error_message = COALESCE(error_message, '') || $2
      WHERE database_id = $1
        AND status = 'creating'
        AND created_at < $3
    `,
    [
      databaseId,
      "[Auto] Sauvegarde expirée : aucune réponse reçue dans le délai de sécurité, verrou libéré automatiquement.",
      staleThreshold,
    ],
  )
}

export type AcquireBackupLockResult =
  | { backupId: string; response: null }
  | { backupId: null; response: NextResponse }

/*
 * Réclame les verrous orphelins de CETTE base, vérifie le quota de
 * backups complétés, puis acquiert le verrou — dans cet ordre, sur le
 * même appelant/connexion, avant que quiconque d'autre ne puisse agir
 * sur cette base (finding M2 §4, "la vérification du quota doit donc
 * être atomique/cohérente avec le verrou de création").
 */
export async function acquireBackupLock(
  databaseId: string,
  serverId: string,
  db: Queryer = { query },
): Promise<AcquireBackupLockResult> {
  await reclaimStaleBackups(databaseId, db)

  const quotaResult = await db.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM backups
      WHERE database_id = $1
        AND status = 'completed'
    `,
    [databaseId],
  )

  if (
    Number(quotaResult.rows[0].count) >=
    MAX_COMPLETED_BACKUPS_PER_DATABASE
  ) {
    return {
      backupId: null,
      response: NextResponse.json(
        {
          status: "error",
          message: `Le nombre maximal de sauvegardes conservées (${MAX_COMPLETED_BACKUPS_PER_DATABASE}) est atteint pour cette base. Supprimez une ancienne sauvegarde avant d'en créer une nouvelle.`,
        },
        { status: 409 },
      ),
    }
  }

  try {
    const result = await db.query<{ id: string }>(
      `
        INSERT INTO backups (
          database_id,
          server_id,
          filename,
          status
        )
        VALUES (
          $1,
          $2,
          '',
          'creating'
        )
        RETURNING id
      `,
      [databaseId, serverId],
    )

    return { backupId: result.rows[0].id, response: null }
  } catch (error) {
    if (isBackupLockViolation(error)) {
      return {
        backupId: null,
        response: NextResponse.json(
          {
            status: "error",
            message: "Une sauvegarde est déjà en cours pour cette base.",
          },
          { status: 409 },
        ),
      }
    }

    throw error
  }
}

export type MarkBackupResult = { applied: boolean }

/*
 * Marque un backup comme terminé sur une issue non nominale (échec
 * réel ou timeout Agent) — libère le verrou en sortant la ligne de
 * l'index unique partiel. CAS explicite : la transition n'est
 * appliquée que si la ligne est ENCORE 'creating' au moment de
 * l'UPDATE (finding H1, leçon appliquée dès le départ ici).
 */
export async function markBackupFailed(
  backupId: string,
  errorMessage: string,
  db: Queryer = { query },
): Promise<MarkBackupResult> {
  const result = await db.query(
    `
      UPDATE backups
      SET
        status = 'failed',
        error_message = $1
      WHERE id = $2
        AND status = 'creating'
    `,
    [errorMessage, backupId],
  )

  const applied = (result.rowCount ?? 0) > 0

  if (!applied) {
    console.warn(
      `Backup ${backupId} : transition vers 'failed' ignorée — ` +
        "la ligne n'était déjà plus 'creating' (réclamée par une autre " +
        "requête, ou déjà terminée par ailleurs). Aucun écrasement effectué.",
    )
  }

  return { applied }
}

export type MarkBackupSuccessFields = {
  filename: string
  sizeBytes: number
}

/*
 * Marque un backup comme réussi — même garde CAS que
 * markBackupFailed : si la ligne n'est plus 'creating' (par exemple
 * réclamée comme 'failed' par une autre requête pendant que l'appel
 * Agent était encore en cours), l'écriture est refusée plutôt que
 * d'écraser silencieusement un état déjà tranché.
 */
export async function markBackupSuccess(
  backupId: string,
  fields: MarkBackupSuccessFields,
  db: Queryer = { query },
): Promise<MarkBackupResult> {
  const result = await db.query(
    `
      UPDATE backups
      SET
        filename = $1,
        size_bytes = $2,
        status = 'completed'
      WHERE id = $3
        AND status = 'creating'
    `,
    [fields.filename, fields.sizeBytes, backupId],
  )

  const applied = (result.rowCount ?? 0) > 0

  if (!applied) {
    console.warn(
      `Backup ${backupId} : transition vers 'completed' ignorée — ` +
        "la ligne n'était déjà plus 'creating' (réclamée par une autre " +
        "requête, ou déjà terminée par ailleurs). Aucun écrasement effectué.",
    )
  }

  return { applied }
}
