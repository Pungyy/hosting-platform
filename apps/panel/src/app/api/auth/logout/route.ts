import { NextResponse, type NextRequest } from "next/server"

import {
  deleteSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session"

/*
 * POST /api/auth/logout
 *
 * Toujours idempotente et sûre, y compris sans cookie ou avec une
 * session déjà expirée/invalide : le seul effet observable garanti est
 * la suppression du cookie côté client (rend ce navigateur incapable
 * de s'authentifier), la révocation côté serveur n'étant qu'un
 * best-effort qui ne doit jamais faire échouer la requête.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value

  if (token) {
    try {
      await deleteSession(token)
    } catch (error) {
      console.error("POST /api/auth/logout error:", error)
    }
  }

  const response = NextResponse.json({ status: "ok" })

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
  })

  return response
}
