import { NextResponse } from "next/server"

import { query, type Queryer } from "@/lib/database"

/*
 * Finding M3-1 (audit sécurité) — quota par tenant sur la création de
 * ressources Docker (sites, bases de données).
 *
 * Sans cette limite, un utilisateur authentifié pouvait créer un
 * nombre illimité de sites/bases, chacun réservant de la RAM/CPU/disque
 * sur l'hôte Docker PARTAGÉ entre tous les tenants — épuisement de
 * ressources pouvant dégrader ou planter les containers de TOUS les
 * autres utilisateurs du même serveur.
 *
 * Mécanisme : un compteur dédié (table `user_resource_quotas`,
 * migration 013), pas un SELECT COUNT(*) sur sites/databases suivi
 * d'un INSERT séparé — insuffisant : deux transactions concurrentes
 * peuvent toutes les deux lire l'ancienne valeur avant qu'aucune n'ait
 * committé. La réservation ci-dessous utilise à la place un
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE, dont l'atomicité vient du
 * verrou de ligne que Postgres pose sur (user_id, resource_type) : une
 * deuxième requête concurrente pour le même utilisateur attend que la
 * première commit, puis réévalue WHERE count < limite contre la valeur
 * à jour — jamais deux réservations ne peuvent toutes les deux réussir
 * au-delà de la limite, quel que soit l'ordonnancement. Même famille de
 * garantie que le CAS déjà utilisé partout ailleurs dans ce projet
 * (markBackupSuccess/markDeploymentSuccess : UPDATE ... WHERE ...
 * RETURNING + vérification de rowCount), appliquée ici à un compteur
 * borné plutôt qu'à une transition d'état.
 *
 * La réservation est effectuée AVANT tout appel à l'Agent (opération
 * lente, externe, non transactionnelle avec Postgres) et doit être
 * explicitement libérée (releaseResourceQuota) par l'appelant sur
 * toute sortie qui ne débouche pas sur la création réelle de la
 * ressource — voir les commentaires dans app/api/sites/route.ts et
 * app/api/databases/route.ts pour la liste exacte de ces sorties.
 */

export type QuotaResourceType = "site" | "database"

export const MAX_SITES_PER_USER = 10
export const MAX_DATABASES_PER_USER = 10

const RESOURCE_LABELS: Record<QuotaResourceType, string> = {
  site: "sites",
  database: "bases de données",
}

export type ReserveQuotaResult =
  | { reserved: true; response: null }
  | { reserved: false; response: NextResponse }

/*
 * Réserve atomiquement un slot de quota pour (userId, resourceType).
 * `limit` est passé explicitement par l'appelant (MAX_SITES_PER_USER /
 * MAX_DATABASES_PER_USER) plutôt que codé en dur ici, pour que le choix
 * de limite reste visible au point d'appel — même esprit que
 * MAX_COMPLETED_BACKUPS_PER_DATABASE, exporté et utilisé directement
 * par son appelant dans lib/resources/backups.ts.
 */
export async function reserveResourceQuota(
  userId: string,
  resourceType: QuotaResourceType,
  limit: number,
  db: Queryer = { query },
): Promise<ReserveQuotaResult> {
  const result = await db.query<{ count: number }>(
    `
      INSERT INTO user_resource_quotas (user_id, resource_type, count)
      VALUES ($1, $2, 1)
      ON CONFLICT (user_id, resource_type)
      DO UPDATE SET
        count = user_resource_quotas.count + 1,
        updated_at = NOW()
      WHERE user_resource_quotas.count < $3
      RETURNING count
    `,
    [userId, resourceType, limit],
  )

  if ((result.rowCount ?? 0) === 0) {
    return {
      reserved: false,
      response: NextResponse.json(
        {
          status: "error",
          message: `Le nombre maximal de ${RESOURCE_LABELS[resourceType]} par utilisateur (${limit}) est atteint. Supprimez une ressource existante avant d'en créer une nouvelle.`,
        },
        { status: 409 },
      ),
    }
  }

  return { reserved: true, response: null }
}

/*
 * Libère un slot précédemment réservé — échec de création après
 * réservation (appel Agent en erreur, ou insertion Postgres échouée).
 * Best-effort, même stratégie que le nettoyage du container orphelin
 * déjà en place dans ces routes (deleteAgentSite/deleteAgentDatabase) :
 * si CETTE requête a réellement réservé un slot, elle doit le rendre
 * quel que soit l'endroit où la création échoue ensuite. GREATEST(...,
 * 0) est une protection défensive (le CHECK count >= 0 empêcherait de
 * toute façon toute valeur négative) plutôt qu'un comportement attendu
 * en fonctionnement normal.
 */
export async function releaseResourceQuota(
  userId: string,
  resourceType: QuotaResourceType,
  db: Queryer = { query },
): Promise<void> {
  await db.query(
    `
      UPDATE user_resource_quotas
      SET count = GREATEST(count - 1, 0), updated_at = NOW()
      WHERE user_id = $1 AND resource_type = $2
    `,
    [userId, resourceType],
  )
}
