import { NextResponse } from "next/server"
import { z } from "zod"

import { createUser } from "@/lib/auth/password"
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session"

/*
 * Aucune règle de complexité au-delà d'une longueur minimale : c'est un
 * choix explicite (pas de règles composites "1 majuscule + 1 chiffre..."
 * dont l'utilité réelle est contestée) plutôt qu'une omission — cohérent
 * avec le seul autre point de contact avec un mot de passe du Panel
 * (login), qui n'impose lui-même aucune règle de forme.
 */
const PASSWORD_MIN_LENGTH = 8

const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(PASSWORD_MIN_LENGTH),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "La confirmation du mot de passe ne correspond pas.",
    path: ["confirmPassword"],
  })

function firstIssuePath(
  error: z.ZodError,
): string | undefined {
  return error.issues[0]?.path[0] as string | undefined
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = registerSchema.safeParse(body)

    if (!parsed.success) {
      const path = firstIssuePath(parsed.error)

      const message =
        path === "confirmPassword"
          ? "La confirmation du mot de passe ne correspond pas."
          : path === "password"
            ? `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`
            : "Adresse email invalide."

      return NextResponse.json(
        { status: "error", message },
        { status: 400 },
      )
    }

    /*
     * Nom par défaut dérivé de l'email (partie locale) : le formulaire
     * ne demande volontairement qu'email + mot de passe + confirmation
     * (minimum requis), mais `users.name` est NOT NULL. Cohérent avec
     * l'auth actuelle, qui n'a jamais eu de champ nom distinct côté UI.
     */
    const defaultName = parsed.data.email.split("@")[0]

    const result = await createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      name: defaultName,
    })

    if (result.status === "email_taken") {
      return NextResponse.json(
        {
          status: "error",
          message: "Cette adresse email est déjà utilisée.",
        },
        { status: 409 },
      )
    }

    /*
     * Connexion automatique après inscription : réutilise exactement le
     * même mécanisme que POST /api/auth/login (createSession + cookie
     * httpOnly identique) — aucun nouveau système de session.
     */
    const session = await createSession(result.user.id)

    const response = NextResponse.json(
      {
        status: "ok",
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
      },
      { status: 201 },
    )

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: session.token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: session.expiresAt,
      path: "/",
    })

    return response
  } catch (error) {
    console.error("POST /api/auth/register error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Une erreur est survenue lors de l'inscription.",
      },
      { status: 500 },
    )
  }
}
