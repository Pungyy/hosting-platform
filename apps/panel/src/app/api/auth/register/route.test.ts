import { afterEach, describe, expect, it, vi } from "vitest"

const { mockCreateUser, mockCreateSession } = vi.hoisted(() => ({
  mockCreateUser: vi.fn(),
  mockCreateSession: vi.fn(),
}))

vi.mock("@/lib/auth/password", () => ({
  createUser: mockCreateUser,
}))

vi.mock("@/lib/auth/session", () => ({
  createSession: mockCreateSession,
  SESSION_COOKIE_NAME: "hosting_session",
}))

import { POST } from "./route"

function registerRequest(body: Record<string, unknown>) {
  return new Request("http://panel.local/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/auth/register", () => {
  afterEach(() => {
    mockCreateUser.mockReset()
    mockCreateSession.mockReset()
  })

  it("inscription valide -> 201, connexion automatique (cookie de session posé), aucun mot de passe dans la réponse", async () => {
    mockCreateUser.mockResolvedValue({
      status: "ok",
      user: { id: "user-1", email: "nouveau@example.com", name: "nouveau", role: "user" },
    })
    mockCreateSession.mockResolvedValue({
      token: "session-token",
      expiresAt: new Date(Date.now() + 3_600_000),
    })

    const response = await POST(
      registerRequest({
        email: "nouveau@example.com",
        password: "un-mot-de-passe-valide",
        confirmPassword: "un-mot-de-passe-valide",
      }),
    )

    expect(response.status).toBe(201)
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: "nouveau@example.com",
      password: "un-mot-de-passe-valide",
      name: "nouveau",
    })
    expect(mockCreateSession).toHaveBeenCalledWith("user-1")

    const body = await response.json()
    expect(body.status).toBe("ok")
    expect(body.user).toEqual({
      id: "user-1",
      email: "nouveau@example.com",
      name: "nouveau",
      role: "user",
    })
    expect(JSON.stringify(body)).not.toContain("un-mot-de-passe-valide")

    const setCookie = response.cookies.get("hosting_session")
    expect(setCookie?.value).toBe("session-token")
  })

  it("email invalide -> 400, createUser jamais appelée", async () => {
    const response = await POST(
      registerRequest({
        email: "pas-un-email",
        password: "un-mot-de-passe-valide",
        confirmPassword: "un-mot-de-passe-valide",
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message).toBe("Adresse email invalide.")
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  it("mot de passe trop court -> 400, createUser jamais appelée", async () => {
    const response = await POST(
      registerRequest({
        email: "user@example.com",
        password: "court1",
        confirmPassword: "court1",
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message).toBe(
      "Le mot de passe doit contenir au moins 8 caractères.",
    )
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  it("confirmation différente -> 400, createUser jamais appelée", async () => {
    const response = await POST(
      registerRequest({
        email: "user@example.com",
        password: "un-mot-de-passe-valide",
        confirmPassword: "un-autre-mot-de-passe",
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message).toBe(
      "La confirmation du mot de passe ne correspond pas.",
    )
    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  it("email déjà existant -> 409, aucune session créée", async () => {
    mockCreateUser.mockResolvedValue({ status: "email_taken" })

    const response = await POST(
      registerRequest({
        email: "deja-utilise@example.com",
        password: "un-mot-de-passe-valide",
        confirmPassword: "un-mot-de-passe-valide",
      }),
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.message).toBe("Cette adresse email est déjà utilisée.")
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it("erreur serveur inattendue -> 500, aucune information sensible exposée", async () => {
    mockCreateUser.mockRejectedValue(
      new Error("connection refused to db host 10.0.0.5:5432"),
    )

    const response = await POST(
      registerRequest({
        email: "user@example.com",
        password: "un-mot-de-passe-valide",
        confirmPassword: "un-mot-de-passe-valide",
      }),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    const bodyText = JSON.stringify(body)
    expect(bodyText).not.toContain("10.0.0.5")
    expect(bodyText).not.toContain("connection refused")
  })

  it("corps invalide (JSON malformé) -> 500, pas de crash non géré", async () => {
    const response = await POST(
      new Request("http://panel.local/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ pas du json valide",
      }),
    )

    expect(response.status).toBe(500)
  })
})
