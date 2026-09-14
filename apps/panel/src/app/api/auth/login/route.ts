import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session"
import { verifyUserPassword } from "@/lib/auth/password"
import { RateLimiter } from "@/lib/auth/rate-limit"
import { getBestEffortClientIp } from "@/lib/auth/request-ip"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/*
 * Rate limiting du brute-force (finding P1 #3) — en mémoire, adapté à
 * une instance Panel unique. À faire évoluer vers un stockage partagé
 * (ex. Redis) en cas de scaling horizontal : chaque instance aurait
 * sinon ses propres compteurs indépendants, diluant la protection d'un
 * facteur égal au nombre d'instances.
 *
 * Fenêtre de 15 minutes. Ne compte QUE les tentatives réellement
 * ÉCHOUÉES (jamais les succès, jamais avant vérification) : le mot de
 * passe est TOUJOURS vérifié normalement, quel que soit l'état du
 * compteur. Un attaquant qui multiplie les mauvais mots de passe sur
 * l'email d'une victime ne peut donc jamais empêcher CETTE victime de
 * se connecter avec son vrai mot de passe — seules les tentatives qui
 * échouent réellement reçoivent un 429 une fois le seuil dépassé.
 * C'est la protection réelle contre le brute-force d'un compte connu ;
 * limiter uniquement par (IP, email) ou couper l'accès même à un mot
 * de passe correct aurait ouvert un DoS trivial (il suffit de connaître
 * l'email de la victime).
 *
 * Le seau IP est un signal secondaire, best-effort (voir
 * lib/auth/request-ip.ts) : ce Panel tourne aujourd'hui SANS reverse
 * proxy devant lui, donc la quasi-totalité des requêtes légitimes n'ont
 * simplement AUCUN en-tête X-Forwarded-For. Les regrouper dans un seau
 * partagé pénaliserait collectivement tous les utilisateurs directs —
 * le seau IP n'est donc appliqué QUE lorsqu'une valeur explicite est
 * présente (un attaquant qui prend la peine d'en fournir une se limite
 * lui-même) ; il ne remplace jamais la protection par email.
 */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const EMAIL_FAILURE_LIMIT = 5
const IP_FAILURE_LIMIT = 20

const emailFailureLimiter = new RateLimiter(
  EMAIL_FAILURE_LIMIT,
  RATE_LIMIT_WINDOW_MS,
)
const ipFailureLimiter = new RateLimiter(
  IP_FAILURE_LIMIT,
  RATE_LIMIT_WINDOW_MS,
)

function tooManyAttemptsResponse(retryAfterMs: number) {
  return NextResponse.json(
    {
      status: "error",
      message: "Trop de tentatives. Réessayez plus tard.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      },
    },
  )
}

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

    const emailKey =
      parsed.data.email.trim().toLowerCase()

    const ip = getBestEffortClientIp(request)

    const user =
      await verifyUserPassword(
        parsed.data.email,
        parsed.data.password,
      )

    if (!user) {
      /*
       * Compté ici, APRÈS la vérification, uniquement parce qu'elle a
       * échoué — un email inexistant et un mauvais mot de passe sur un
       * email existant incrémentent le même compteur de la même façon,
       * donc aucune énumération possible via ce mécanisme.
       */
      const emailResult =
        emailFailureLimiter.check(emailKey)

      const ipResult =
        ip === "unknown"
          ? null
          : ipFailureLimiter.check(ip)

      if (
        !emailResult.allowed ||
        (ipResult && !ipResult.allowed)
      ) {
        return tooManyAttemptsResponse(
          Math.max(
            emailResult.retryAfterMs,
            ipResult?.retryAfterMs ?? 0,
          ),
        )
      }

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

    emailFailureLimiter.reset(emailKey)

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
