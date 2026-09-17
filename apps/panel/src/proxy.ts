import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie"

/*
 * Contrôle optimiste : on vérifie uniquement la *présence* du cookie de
 * session (pas de requête base de données ici). La validation réelle du
 * token reste faite par `getCurrentSession()` / `requireSession()` dans
 * les handlers et les composants serveur.
 */

/*
 * Routes API accessibles sans session :
 * - login du panel
 * - endpoints appelés par l'Agent (auth par token Agent / token d'enrôlement)
 */
const PUBLIC_API_ROUTES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/register",
  "/api/servers/authenticate",
  "/api/servers/enroll",
  "/api/servers/heartbeat",
]

/*
 * Pages accessibles sans session : login et inscription. Un utilisateur
 * déjà authentifié qui y accède est renvoyé vers "/" (voir plus bas) —
 * même règle pour les deux, pas de raison de rester sur une page
 * d'authentification une fois connecté.
 */
const PUBLIC_PAGES = ["/login", "/register"]

function isPublicApiRoute(pathname: string) {
  return PUBLIC_API_ROUTES.some(
    (route) =>
      pathname === route || pathname.startsWith(`${route}/`),
  )
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME)
  const isApi = pathname.startsWith("/api/")

  if (isApi && isPublicApiRoute(pathname)) {
    return NextResponse.next()
  }

  if (hasSession) {
    if (PUBLIC_PAGES.includes(pathname)) {
      return NextResponse.redirect(new URL("/", request.nextUrl))
    }

    return NextResponse.next()
  }

  if (isApi) {
    return NextResponse.json(
      {
        status: "error",
        message: "Authentification requise.",
      },
      { status: 401 },
    )
  }

  if (PUBLIC_PAGES.includes(pathname)) {
    return NextResponse.next()
  }

  const loginUrl = new URL("/login", request.nextUrl)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf les assets statiques Next et les fichiers image.
     */
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
}
