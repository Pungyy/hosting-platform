import { NextResponse } from "next/server"

import { query, type Queryer } from "@/lib/database"

/*
 * Finding H1 (audit sécurité) — verrou "un seul deployment 'running'
 * par site" à la fois.
 *
 * Le verrou lui-même est l'index unique partiel `deployments`
 * (`idx_deployments_one_running_per_site`, migration 011) : c'est
 * Postgres qui garantit l'atomicité, pas ce module — deux appels
 * concurrents à acquireDeploymentLock() pour le même site_id ne
 * peuvent jamais tous les deux réussir leur INSERT, quel que soit
 * l'ordonnancement des transactions. Ce module se contente de
 * traduire la violation de contrainte en réponse HTTP 409.
 *
 * Un deployment sort de lui-même de cet index dès que son status
 * change (success/failed/cancelled) — pas d'étape "unlock" séparée à
 * appeler ni à oublier.
 */

/*
 * Si un deployment reste 'running' au-delà de ce délai, on le
 * considère abandonné (crash/restart du Panel ou de l'Agent avant la
 * mise à jour finale) et on le marque failed avant de tenter d'en
 * créer un nouveau — sinon le verrou resterait bloqué indéfiniment
 * sans intervention manuelle. Valeur nettement supérieure au timeout
 * dur du build côté Agent (8 min, voir apps/agent/src/services/
 * deployment.ts) + une marge réseau généreuse, pour ne jamais réclamer
 * à tort un deployment encore légitimement en cours.
 */
export const STALE_DEPLOYMENT_LOCK_MS = 15 * 60 * 1000

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

export type AcquireDeploymentLockResult =
  | { deploymentId: string; response: null }
  | { deploymentId: null; response: NextResponse }

export async function acquireDeploymentLock(
  siteId: string,
  branch: string,
  db: Queryer = { query },
): Promise<AcquireDeploymentLockResult> {
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
 * Marque un deployment comme terminé sur une issue non nominale
 * (échec réel ou annulation par timeout) — libère le verrou en
 * sortant la ligne de l'index unique partiel. Le cas "success", qui
 * écrit davantage de colonnes (commit_sha, image, container...), reste
 * géré directement par la route : ce helper ne couvre que ce dont le
 * verrou a besoin pour être correctement relâché.
 */
export async function markDeploymentTerminal(
  deploymentId: string,
  status: "failed" | "cancelled",
  logMessage: string,
  db: Queryer = { query },
): Promise<void> {
  await db.query(
    `
      UPDATE deployments
      SET
        status = $1,
        finished_at = NOW(),
        logs = COALESCE(logs, '') || $2
      WHERE id = $3
    `,
    [status, logMessage, deploymentId],
  )
}
