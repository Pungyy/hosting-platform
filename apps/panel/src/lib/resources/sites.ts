import type { NextResponse } from "next/server"

import { isAdmin } from "@/lib/auth/roles"
import type { Session } from "@/lib/auth/session"
import { query, type Queryer } from "@/lib/database"
import { notFoundResponse } from "@/lib/resources/shared"

export type OwnedSite = {
  id: string
  user_id: string
  server_id: string
  name: string
  container_name: string
  container_id: string | null
  image: string
  status: string
  repository_url: string | null
  repository_branch: string | null
  build_path: string | null
  created_at: string
  server_name: string | null
  server_hostname: string | null
}

/*
 * Charge un site par id et vérifie que la session appelante en est
 * propriétaire (ou est admin — cf. décision produit : un admin voit/gère
 * toutes les ressources). Renvoie exactement la même réponse 404, avec le
 * même message, que le site n'existe pas ou qu'il appartienne à un autre
 * utilisateur — jamais de 403 qui confirmerait son existence.
 *
 * Couvre à elle seule tous les besoins actuels de lecture d'un site
 * (id/name/server_id/container_name/... + nom et hostname du serveur via
 * la jointure) : les routes n'ont plus qu'à appeler ce chargeur au lieu de
 * répéter leur propre SELECT.
 */
export async function getOwnedSite(
  id: string,
  session: Session,
  db: Queryer = { query },
): Promise<
  | { site: OwnedSite; response: null }
  | { site: null; response: NextResponse }
> {
  const result = await db.query<OwnedSite>(
    `
      SELECT
        s.id,
        s.user_id,
        s.server_id,
        s.name,
        s.container_name,
        s.container_id,
        s.image,
        s.status,
        s.repository_url,
        s.repository_branch,
        s.build_path,
        s.created_at,
        srv.name AS server_name,
        srv.hostname AS server_hostname
      FROM sites s
      LEFT JOIN servers srv ON srv.id = s.server_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [id],
  )

  const site = result.rows[0]

  if (!site || (!isAdmin(session) && site.user_id !== session.user_id)) {
    return { site: null, response: notFoundResponse("Site introuvable.") }
  }

  return { site, response: null }
}
