import type { NextResponse } from "next/server"

import { isAdmin } from "@/lib/auth/roles"
import type { Session } from "@/lib/auth/session"
import { query, type Queryer } from "@/lib/database"
import { notFoundResponse } from "@/lib/resources/shared"

export type OwnedDatabase = {
  id: string
  user_id: string
  server_id: string
  name: string
  engine: string
  container_name: string
  container_id: string | null
  image: string
  status: string
  database_name: string
  username: string
  password_encrypted: string
  internal_host: string
  internal_port: number
  created_at: string
  server_name: string | null
  server_hostname: string | null
}

/*
 * Charge une base de données par id et vérifie que la session appelante en
 * est propriétaire (ou est admin). Même stratégie 404 que getOwnedSite.
 *
 * ⚠️ password_encrypted est inclus dans la ligne retournée parce que
 * GET /api/databases/[id] en a besoin pour le déchiffrer et l'afficher au
 * propriétaire — comportement produit voulu, cf. audit du 2026-09-13.
 * Toutes les AUTRES routes (action, logs, delete, backups) doivent
 * simplement ignorer ce champ ; ce n'est pas au chargeur de le filtrer,
 * c'est à chaque route de ne renvoyer que ce dont elle a besoin.
 */
export async function getOwnedDatabase(
  id: string,
  session: Session,
  db: Queryer = { query },
): Promise<
  | { database: OwnedDatabase; response: null }
  | { database: null; response: NextResponse }
> {
  const result = await db.query<OwnedDatabase>(
    `
      SELECT
        d.id,
        d.user_id,
        d.server_id,
        d.name,
        d.engine,
        d.container_name,
        d.container_id,
        d.image,
        d.status,
        d.database_name,
        d.username,
        d.password_encrypted,
        d.internal_host,
        d.internal_port,
        d.created_at,
        srv.name AS server_name,
        srv.hostname AS server_hostname
      FROM databases d
      LEFT JOIN servers srv ON srv.id = d.server_id
      WHERE d.id = $1
      LIMIT 1
    `,
    [id],
  )

  const database = result.rows[0]

  if (
    !database ||
    (!isAdmin(session) && database.user_id !== session.user_id)
  ) {
    return {
      database: null,
      response: notFoundResponse("Base de données introuvable."),
    }
  }

  return { database, response: null }
}
