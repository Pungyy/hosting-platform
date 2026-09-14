import { NextResponse } from "next/server"

import { AGENT_DEPLOYMENT_TIMEOUT_MS } from "@/lib/agent/client"
import { query, type Queryer } from "@/lib/database"

/*
 * Finding H1 (audit sécurité) — verrou "un seul deployment 'running'
 * par site" à la fois.
 *
 * Le verrou lui-même est l'index unique partiel `deployments`
 * (`idx_deployments_one_running_per_site`, migration 011) : c'est
 * Postgres qui garantit l'atomicité de l'ACQUISITION, pas ce module —
 * deux appels concurrents à acquireDeploymentLock() pour le même
 * site_id ne peuvent jamais tous les deux réussir leur INSERT.
 *
 * Un deployment sort de lui-même de cet index dès que son status
 * change (success/failed/cancelled). Mais l'acquisition atomique ne
 * suffit pas : la TRANSITION FINALE (running -> état terminal) doit
 * elle aussi être protégée, sinon une requête qui met anormalement
 * longtemps à répondre peut écraser un statut déjà réclamé par une
 * autre requête (revue indépendante du commit H1 initial). Toutes les
 * transitions terminales passent donc par un UPDATE ... WHERE status
 * = 'running' (compare-and-swap) et vérifient rowCount : si 0 ligne
 * n'a été affectée, c'est qu'une autre requête a déjà tranché — jamais
 * un écrasement silencieux.
 */

/*
 * Invariant timeout Agent / stale-lock Panel (correction du finding
 * H1 signalée par la revue indépendante) : STALE_DEPLOYMENT_LOCK_MS
 * DOIT rester strictement supérieur à la durée totale que le Panel a
 * lui-même autorisée à l'Agent pour l'ENSEMBLE de l'opération de
 * déploiement (build + remplacement du container + nettoyage — voir
 * AGENT_DEPLOYMENT_TIMEOUT_MS dans lib/agent/client.ts, qui est la
 * valeur littéralement envoyée à l'Agent à chaque appel).
 *
 * Plutôt que deux nombres indépendants choisis séparément (le bug
 * structurel signalé par la revue), ce seuil est une DÉRIVATION
 * arithmétique de cette même constante : il ne peut plus dériver
 * silencieusement, seulement être modifié délibérément au même
 * endroit. Voir deployments.test.ts pour le test qui échoue si cette
 * relation est violée.
 */
export const RECLAIM_SAFETY_MARGIN_MS = 5 * 60 * 1000

export const STALE_DEPLOYMENT_LOCK_MS =
  AGENT_DEPLOYMENT_TIMEOUT_MS + RECLAIM_SAFETY_MARGIN_MS

const DEPLOYMENT_LOCK_CONSTRAINT =
  "idx_deployments_one_running_per_site"

function isDeploymentLockViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const pgError = error as {
    code?: unknown
    constraint?: unknown
  }

  return (
    pgError.code === "23505" &&
    pgError.constraint === DEPLOYMENT_LOCK_CONSTRAINT
  )
}

/*
 * Réclamation paresseuse des verrous orphelins (crash/restart du Panel
 * ou de l'Agent avant la mise à jour finale) — isolée dans sa propre
 * fonction, exportée, pour être testable indépendamment du flux
 * complet d'acquisition (voir deployments.test.ts : la revue
 * indépendante notait que le test précédent ne l'isolait pas
 * réellement).
 */
export async function reclaimStaleDeployments(
  siteId: string,
  db: Queryer = { query },
): Promise<void> {
  const staleThreshold = new Date(
    Date.now() - STALE_DEPLOYMENT_LOCK_MS,
  )

  await db.query(
    `
      UPDATE deployments
      SET
        status = 'failed',
        finished_at = NOW(),
        logs = COALESCE(logs, '') || $2
      WHERE site_id = $1
        AND status = 'running'
        AND started_at < $3
    `,
    [
      siteId,
      "\n\n[Auto] Déploiement expiré : aucune réponse reçue dans le délai de sécurité, verrou libéré automatiquement.",
      staleThreshold,
    ],
  )
}

export type AcquireDeploymentLockResult =
  | { deploymentId: string; response: null }
  | { deploymentId: null; response: NextResponse }

export async function acquireDeploymentLock(
  siteId: string,
  branch: string,
  db: Queryer = { query },
): Promise<AcquireDeploymentLockResult> {
  await reclaimStaleDeployments(siteId, db)

  try {
    const result = await db.query<{ id: string }>(
      `
        INSERT INTO deployments (
          site_id,
          branch,
          status,
          started_at
        )
        VALUES (
          $1,
          $2,
          'running',
          NOW()
        )
        RETURNING id
      `,
      [siteId, branch],
    )

    return { deploymentId: result.rows[0].id, response: null }
  } catch (error) {
    if (isDeploymentLockViolation(error)) {
      return {
        deploymentId: null,
        response: NextResponse.json(
          {
            status: "error",
            message: "Un déploiement est déjà en cours pour ce site.",
          },
          { status: 409 },
        ),
      }
    }

    throw error
  }
}

/*
 * Résultat commun à toute transition terminale : `applied` indique si
 * CETTE requête a réellement effectué la transition (rowCount > 0) ou
 * si la ligne était déjà dans un état terminal au moment de l'UPDATE
 * (réclamée par une autre requête, ou déjà mise à jour par ailleurs) —
 * dans ce dernier cas, rien n'a été écrasé, mais l'appelant doit le
 * savoir pour ne jamais prétendre à un résultat qui ne correspond plus
 * à l'état réel enregistré.
 */
export type MarkDeploymentResult = { applied: boolean }

/*
 * Marque un deployment comme terminé sur une issue non nominale
 * (échec réel ou annulation par timeout) — libère le verrou en
 * sortant la ligne de l'index unique partiel. CAS explicite : la
 * transition n'est appliquée que si la ligne est ENCORE 'running' au
 * moment de l'UPDATE.
 */
export async function markDeploymentTerminal(
  deploymentId: string,
  status: "failed" | "cancelled",
  logMessage: string,
  db: Queryer = { query },
): Promise<MarkDeploymentResult> {
  const result = await db.query(
    `
      UPDATE deployments
      SET
        status = $1,
        finished_at = NOW(),
        logs = COALESCE(logs, '') || $2
      WHERE id = $3
        AND status = 'running'
    `,
    [status, logMessage, deploymentId],
  )

  const applied = (result.rowCount ?? 0) > 0

  if (!applied) {
    console.warn(
      `Deployment ${deploymentId} : transition vers '${status}' ignorée — ` +
        "la ligne n'était déjà plus 'running' (réclamée par une autre " +
        "requête, ou déjà terminée par ailleurs). Aucun écrasement effectué.",
    )
  }

  return { applied }
}

export type MarkDeploymentSuccessFields = {
  commitSha: string | null
  logs: string
  imageName: string | null
  imageId: string | null
  containerName: string | null
  containerId: string | null
}

/*
 * Marque un deployment comme réussi — même garde CAS que
 * markDeploymentTerminal : si la ligne n'est plus 'running' (par
 * exemple réclamée comme 'failed' par une autre requête pendant que
 * l'appel Agent était encore en cours), l'écriture est refusée plutôt
 * que d'écraser silencieusement un état déjà tranché.
 */
export async function markDeploymentSuccess(
  deploymentId: string,
  fields: MarkDeploymentSuccessFields,
  db: Queryer = { query },
): Promise<MarkDeploymentResult> {
  const result = await db.query(
    `
      UPDATE deployments
      SET
        commit_sha = $1,
        status = 'success',
        finished_at = NOW(),
        logs = $2,
        image_name = $3,
        image_id = $4,
        container_name = $5,
        container_id = $6
      WHERE id = $7
        AND status = 'running'
    `,
    [
      fields.commitSha,
      fields.logs,
      fields.imageName,
      fields.imageId,
      fields.containerName,
      fields.containerId,
      deploymentId,
    ],
  )

  const applied = (result.rowCount ?? 0) > 0

  if (!applied) {
    console.warn(
      `Deployment ${deploymentId} : transition vers 'success' ignorée — ` +
        "la ligne n'était déjà plus 'running' (réclamée par une autre " +
        "requête, ou déjà terminée par ailleurs). Aucun écrasement effectué.",
    )
  }

  return { applied }
}
