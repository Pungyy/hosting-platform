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

/*
 * Finding M3-2 (audit sécurité) — plafond de deployments 'running'
 * SIMULTANÉS par tenant, en plus du verrou H1 (1 par site).
 *
 * Le verrou H1 n'a aucune portée cross-site : un tenant possédant
 * plusieurs sites (jusqu'à 10, finding M3-1) pouvait déclencher un
 * build (jusqu'à 1 Gio RAM / 1.0 CPU chacun) simultanément sur CHACUN
 * de ses sites, sans aucune limite — voir migration 014 pour le
 * raisonnement complet sur le risque (contention mémoire réelle sur
 * l'hôte Docker partagé, OOM killer pouvant affecter d'autres tenants).
 *
 * Compteur SÉPARÉ de user_resource_quotas (M3-1, table
 * user_resource_quotas) : sémantique différente — celui-ci ne reflète
 * QUE les deployments ACTUELLEMENT 'running' (jamais un total
 * historique). Incrémenté uniquement après acquisition RÉUSSIE du
 * verrou H1 (acquireTenantDeploymentSlot), décrémenté dès que le
 * deployment quitte réellement 'running' — que ce soit par cette même
 * requête (succès/échec/timeout) OU par une réclamation de verrou
 * orphelin déclenchée par une AUTRE requête (reclaimStaleDeployments,
 * qui libère alors le slot lui-même, voir plus bas : c'est la seule
 * façon dont un deployment peut quitter 'running' sans que le code de
 * la requête d'origine ne s'exécute).
 *
 * Mécanisme d'atomicité identique à M3-1 : INSERT ... ON CONFLICT DO
 * UPDATE ... WHERE count < limite RETURNING — jamais un
 * SELECT COUNT(*) puis INSERT séparé.
 */
export const MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT = 2

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

export type AcquireTenantSlotResult =
  | { acquired: true; response: null }
  | { acquired: false; response: NextResponse }

/*
 * Réserve atomiquement un slot de concurrence pour ce tenant — appelée
 * UNIQUEMENT après acquisition réussie du verrou H1 (voir
 * acquireDeploymentLock), jamais avant : un site déjà en déploiement
 * doit renvoyer son 409 propre sans jamais consommer un slot tenant
 * pour un déploiement qui n'aurait de toute façon pas pu démarrer.
 *
 * Même mécanisme que reserveResourceQuota (M3-1, lib/resources/
 * quotas.ts) : le verrou de ligne Postgres sur `user_id` rend cette
 * réservation atomique — deux requêtes concurrentes pour le MÊME
 * tenant sont sérialisées, jamais toutes les deux acceptées au-delà de
 * MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT.
 */
export async function acquireTenantDeploymentSlot(
  userId: string,
  db: Queryer = { query },
): Promise<AcquireTenantSlotResult> {
  const result = await db.query<{ count: number }>(
    `
      INSERT INTO tenant_deployment_slots (user_id, count)
      VALUES ($1, 1)
      ON CONFLICT (user_id)
      DO UPDATE SET
        count = tenant_deployment_slots.count + 1,
        updated_at = NOW()
      WHERE tenant_deployment_slots.count < $2
      RETURNING count
    `,
    [userId, MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT],
  )

  if ((result.rowCount ?? 0) === 0) {
    return {
      acquired: false,
      response: NextResponse.json(
        {
          status: "error",
          message: `Vous avez déjà ${MAX_CONCURRENT_DEPLOYMENTS_PER_TENANT} déploiements en cours. Attendez qu'un déploiement se termine avant d'en lancer un nouveau.`,
        },
        { status: 409 },
      ),
    }
  }

  return { acquired: true, response: null }
}

/*
 * Libère un slot de concurrence précédemment acquis. Best-effort,
 * GREATEST(..., 0) en défense en profondeur (le CHECK count >= 0 de la
 * table l'empêcherait de toute façon) — jamais un comportement attendu
 * en fonctionnement normal.
 *
 * Appelée depuis DEUX endroits seulement, chacun garantissant qu'elle
 * n'est déclenchée QU'UNE SEULE FOIS par slot réellement détenu
 * (jamais un double décrément) :
 *   1. reclaimStaleDeployments ci-dessous, conditionnée à rowCount > 0
 *      (elle a réellement réclamé CE deployment) ;
 *   2. app/api/sites/[id]/deploy/route.ts, conditionnée au flag local
 *      qui suit si CETTE requête détient encore le slot ET au résultat
 *      `applied` du CAS terminal (si `applied` est faux, une autre
 *      requête — typiquement reclaimStaleDeployments — a déjà transitionné
 *      ce deployment ET déjà libéré son slot : la route ne doit alors
 *      jamais libérer une seconde fois).
 */
export async function releaseTenantDeploymentSlot(
  userId: string,
  db: Queryer = { query },
): Promise<void> {
  await db.query(
    `
      UPDATE tenant_deployment_slots
      SET count = GREATEST(count - 1, 0), updated_at = NOW()
      WHERE user_id = $1
    `,
    [userId],
  )
}

/*
 * Réclamation paresseuse des verrous orphelins (crash/restart du Panel
 * ou de l'Agent avant la mise à jour finale) — isolée dans sa propre
 * fonction, exportée, pour être testable indépendamment du flux
 * complet d'acquisition (voir deployments.test.ts : la revue
 * indépendante notait que le test précédent ne l'isolait pas
 * réellement).
 *
 * `userId` (finding M3-2) : requis pour libérer le slot de
 * concurrence du TENANT quand cette fonction réclame effectivement un
 * verrou orphelin — c'est la SEULE façon dont un deployment peut
 * quitter 'running' sans que le code de la requête qui l'a créé ne
 * s'exécute (celle-ci peut être bloquée indéfiniment sur un appel
 * Agent mort). Le WHERE ci-dessous garantit qu'au plus UNE ligne peut
 * être affectée (au plus un deployment 'running' par site, invariant
 * H1) : la libération n'est donc jamais faite "en boucle", elle est
 * conditionnée par rowCount > 0, donc jamais déclenchée pour un site
 * qui n'avait en réalité rien à réclamer.
 */
export async function reclaimStaleDeployments(
  siteId: string,
  userId: string,
  db: Queryer = { query },
): Promise<void> {
  const staleThreshold = new Date(
    Date.now() - STALE_DEPLOYMENT_LOCK_MS,
  )

  const result = await db.query(
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

  if ((result.rowCount ?? 0) > 0) {
    await releaseTenantDeploymentSlot(userId, db)
  }
}

export type AcquireDeploymentLockResult =
  | { deploymentId: string; response: null }
  | { deploymentId: null; response: NextResponse }

export async function acquireDeploymentLock(
  siteId: string,
  userId: string,
  branch: string,
  db: Queryer = { query },
): Promise<AcquireDeploymentLockResult> {
  await reclaimStaleDeployments(siteId, userId, db)

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
