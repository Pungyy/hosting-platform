import { NextResponse } from "next/server"

import { getCurrentSession } from "@/lib/auth/session"

type SessionResult = Awaited<ReturnType<typeof getCurrentSession>>

/*
 * Vérifie qu'une session valide existe.
 *
 * Usage dans un handler de route :
 *
 *   const { session, response } = await requireSession()
 *   if (response) return response
 *   // ... session est garantie non nulle ici
 */
export async function requireSession(): Promise<
  | { session: NonNullable<SessionResult>; response: null }
  | { session: null; response: NextResponse }
> {
  const session = await getCurrentSession()

  if (!session) {
    return {
      session: null,
      response: NextResponse.json(
        {
          status: "error",
          message: "Authentification requise.",
        },
        { status: 401 },
      ),
    }
  }

  return { session, response: null }
}
