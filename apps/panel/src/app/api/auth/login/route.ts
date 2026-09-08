import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session"
import { verifyUserPassword } from "@/lib/auth/password"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(
  request: Request,
) {
  try {
    const body =
      await request.json()

    const parsed =
      loginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Adresse email ou mot de passe invalide.",
        },
        {
          status: 400,
        },
      )
    }

    const user =
      await verifyUserPassword(
        parsed.data.email,
        parsed.data.password,
      )

    if (!user) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Adresse email ou mot de passe incorrect.",
        },
        {
          status: 401,
        },
      )
    }

    const session =
      await createSession(user.id)

    const response =
      NextResponse.json(
        {
          status: "ok",
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        },
        {
          status: 200,
        },
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
    console.error(
      "POST /api/auth/login error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Une erreur est survenue lors de la connexion.",
      },
      {
        status: 500,
      },
    )
  }
}
