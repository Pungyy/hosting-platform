import { NextResponse } from "next/server"

import type { Session } from "@/lib/auth/session"

/*
 * Vérifie le rôle d'une session déjà chargée (via requireSession()) — pas
 * de second aller-retour base de données, et testable sans DB ni cookies
 * puisque isAdmin/requireAdmin sont de simples fonctions pures sur l'objet
 * session.
 */
export function isAdmin(session: Pick<Session, "role">): boolean {
  return session.role === "admin"
}

/*
 * Usage (après requireSession()) :
 *
 *   const { session, response: authError } = await requireSession()
 *   if (authError) return authError
 *
 *   const { response: roleError } = requireAdmin(session)
 *   if (roleError) return roleError
 */
export function requireAdmin(
  session: Pick<Session, "role">,
): { response: null } | { response: NextResponse } {
  if (!isAdmin(session)) {
    return {
      response: NextResponse.json(
        { status: "error", message: "Accès réservé aux administrateurs." },
        { status: 403 },
      ),
    }
  }

  return { response: null }
}

/*
 * Portée d'une route de liste globale (GET /api/sites, /api/databases,
 * /api/domains, /api/deployments, /api/backups) :
 *   - par défaut (pas de ?scope=all) : uniquement les ressources de
 *     l'utilisateur courant, admin inclus.
 *   - ?scope=all : toutes les ressources de tous les tenants — réservé
 *     aux admins, 403 explicite sinon (contrairement au 404 des
 *     chargeurs par id, il n'y a pas d'identifiant à cacher ici : le
 *     paramètre de requête lui-même est le sujet du refus).
 */
export function resolveListScope(
  request: Request,
  session: Pick<Session, "role">,
): { scope: "own" | "all"; response: null } | { response: NextResponse } {
  const wantsAll =
    new URL(request.url).searchParams.get("scope") === "all"

  if (!wantsAll) {
    return { scope: "own", response: null }
  }

  if (!isAdmin(session)) {
    return {
      response: NextResponse.json(
        {
          status: "error",
          message: "scope=all est réservé aux administrateurs.",
        },
        { status: 403 },
      ),
    }
  }

  return { scope: "all", response: null }
}
