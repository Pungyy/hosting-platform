import { afterEach, describe, expect, it, vi } from "vitest"

const { mockVerifyUserPassword, mockCreateSession } = vi.hoisted(() => ({
  mockVerifyUserPassword: vi.fn(),
  mockCreateSession: vi.fn(),
}))

vi.mock("@/lib/auth/password", () => ({
  verifyUserPassword: mockVerifyUserPassword,
}))

vi.mock("@/lib/auth/session", () => ({
  createSession: mockCreateSession,
  SESSION_COOKIE_NAME: "hosting_session",
}))

import { POST } from "./route"

function loginRequest(
  email: string,
  password = "wrong-password",
  ip?: string,
) {
  return new Request("http://panel.local/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({ email, password }),
  })
}

/*
 * Chaque test utilise un email (et souvent une IP) UNIQUE : les
 * limiteurs sont des singletons au niveau du module, partagés entre
 * tous les tests de ce fichier (comme en production, une seule
 * instance) — les clés doivent donc être isolées entre scénarios.
 */
let emailCounter = 0
function uniqueEmail() {
  emailCounter += 1
  return `user-${emailCounter}@example.com`
}

describe("POST /api/auth/login — rate limiting (finding P1 #3)", () => {
  afterEach(() => {
    vi.useRealTimers()
    mockVerifyUserPassword.mockReset()
    mockCreateSession.mockReset()
  })

  it("tentatives sous la limite -> toujours 401 générique, jamais 429", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)
    const email = uniqueEmail()

    for (let i = 0; i < 4; i++) {
      const response = await POST(loginRequest(email))
      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.message).toBe("Adresse email ou mot de passe incorrect.")
    }
  })

  it("dépassement de la limite par email -> 429 avec Retry-After", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)
    const email = uniqueEmail()

    for (let i = 0; i < 5; i++) {
      const response = await POST(loginRequest(email))
      expect(response.status).toBe(401)
    }

    const blocked = await POST(loginRequest(email))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()

    const body = await blocked.json()
    expect(body).toEqual({
      status: "error",
      message: "Trop de tentatives. Réessayez plus tard.",
    })
  })

  it("un mot de passe CORRECT réussit toujours, même après le seuil de mauvaises tentatives (pas de DoS trivial d'un compte connu)", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)
    const email = uniqueEmail()

    // Un attaquant épuise le quota de mauvaises tentatives pour cet email.
    for (let i = 0; i < 6; i++) {
      await POST(loginRequest(email, "mauvais-mot-de-passe"))
    }

    // Le vrai propriétaire du compte peut quand même se connecter.
    mockVerifyUserPassword.mockResolvedValue({
      id: "user-1",
      email,
      name: "Utilisateur",
      role: "user",
    })
    mockCreateSession.mockResolvedValue({
      token: "session-token",
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    const response = await POST(loginRequest(email, "le-bon-mot-de-passe"))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe("ok")
  })

  it("email inexistant ne permet pas d'énumération : mêmes statut/message qu'un mauvais mot de passe sur un compte existant, y compris une fois le seuil dépassé", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)
    const nonexistentEmail = uniqueEmail()
    const existingEmailWithWrongPassword = uniqueEmail()

    const resultsNonexistent: Array<{ status: number; message: string }> = []
    const resultsExisting: Array<{ status: number; message: string }> = []

    for (let i = 0; i < 6; i++) {
      const r1 = await POST(loginRequest(nonexistentEmail))
      resultsNonexistent.push({ status: r1.status, message: (await r1.json()).message })

      const r2 = await POST(loginRequest(existingEmailWithWrongPassword))
      resultsExisting.push({ status: r2.status, message: (await r2.json()).message })
    }

    expect(resultsNonexistent).toEqual(resultsExisting)
    // Les 5 premières échouent en 401, la 6e est limitée en 429 — identique
    // dans les deux cas, donc aucune différence observable ne révèle si
    // l'email correspond à un compte réel.
    expect(resultsNonexistent.slice(0, 5).every((r) => r.status === 401)).toBe(true)
    expect(resultsNonexistent[5].status).toBe(429)
  })

  it("limite par IP appliquée indépendamment de l'email (plusieurs emails différents, même IP)", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)
    const sharedIp = "203.0.113.77"

    // 20 tentatives sur 20 emails DIFFÉRENTS depuis la même IP revendiquée :
    // aucun email individuel n'atteint son propre seuil (5), mais le seau IP
    // (limite 20) doit se déclencher.
    let lastResponse
    for (let i = 0; i < 20; i++) {
      lastResponse = await POST(loginRequest(uniqueEmail(), "x", sharedIp))
      expect(lastResponse.status).toBe(401)
    }

    const blocked = await POST(loginRequest(uniqueEmail(), "x", sharedIp))
    expect(blocked.status).toBe(429)
  })

  it("limite par email appliquée même si l'IP revendiquée change à chaque tentative", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)
    const email = uniqueEmail()

    for (let i = 0; i < 5; i++) {
      const response = await POST(
        loginRequest(email, "x", `198.51.100.${i}`),
      )
      expect(response.status).toBe(401)
    }

    const blocked = await POST(
      loginRequest(email, "x", "198.51.100.250"),
    )
    expect(blocked.status).toBe(429)
  })

  it("sans en-tête IP (déploiement actuel sans reverse proxy) -> pas de blocage collectif entre utilisateurs différents", async () => {
    mockVerifyUserPassword.mockResolvedValue(null)

    // 30 utilisateurs différents, aucun n'envoie d'en-tête X-Forwarded-For
    // (cas normal d'un navigateur direct) : le seau IP "unknown" ne doit
    // jamais être appliqué, sous peine de bloquer tout le monde ensemble.
    for (let i = 0; i < 30; i++) {
      const response = await POST(loginRequest(uniqueEmail()))
      expect(response.status).toBe(401)
    }
  })

  it("une fenêtre qui expire redevient autorisée", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)

    mockVerifyUserPassword.mockResolvedValue(null)
    const email = uniqueEmail()

    for (let i = 0; i < 6; i++) {
      await POST(loginRequest(email))
    }

    const stillBlocked = await POST(loginRequest(email))
    expect(stillBlocked.status).toBe(429)

    vi.setSystemTime(1_700_000_000_000 + 15 * 60 * 1000 + 1)

    const afterWindow = await POST(loginRequest(email))
    expect(afterWindow.status).toBe(401)
  })

  it("réinitialise le compteur d'échecs après une connexion réussie (pas de report résiduel)", async () => {
    const email = uniqueEmail()

    // 4 échecs — sous le seuil de 5, mais proche.
    mockVerifyUserPassword.mockResolvedValue(null)
    for (let i = 0; i < 4; i++) {
      const response = await POST(loginRequest(email))
      expect(response.status).toBe(401)
    }

    // Connexion réussie : doit vider le compteur de 4 échecs précédents.
    mockVerifyUserPassword.mockResolvedValue({
      id: "user-2",
      email,
      name: "Utilisateur",
      role: "user",
    })
    mockCreateSession.mockResolvedValue({
      token: "session-token",
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    const success = await POST(loginRequest(email, "bon-mot-de-passe"))
    expect(success.status).toBe(200)

    // Si le compteur n'avait pas été remis à zéro, un seul échec de plus
    // suffirait à atteindre le seuil (4 + 1 = 5) et le suivant serait
    // bloqué immédiatement. Ici, 5 nouveaux échecs doivent à nouveau
    // tous passer en 401 avant que le 6e ne soit limité.
    mockVerifyUserPassword.mockResolvedValue(null)
    for (let i = 0; i < 5; i++) {
      const response = await POST(loginRequest(email))
      expect(response.status).toBe(401)
    }

    const blocked = await POST(loginRequest(email))
    expect(blocked.status).toBe(429)
  })

  it("comportement 400/500 existant inchangé (corps invalide)", async () => {
    const response = await POST(
      new Request("http://panel.local/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "pas-un-email" }),
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message).toBe("Adresse email ou mot de passe invalide.")
  })
})
