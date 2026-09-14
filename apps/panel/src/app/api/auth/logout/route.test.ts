import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockDeleteSession } = vi.hoisted(() => ({
  mockDeleteSession: vi.fn(),
}))

vi.mock("@/lib/auth/session", () => ({
  deleteSession: mockDeleteSession,
  SESSION_COOKIE_NAME: "hosting_session",
}))

import { POST } from "./route"

function requestWithCookie(cookieValue?: string) {
  return new NextRequest("http://panel.local/api/auth/logout", {
    method: "POST",
    headers: cookieValue
      ? { cookie: `hosting_session=${cookieValue}` }
      : undefined,
  })
}

describe("POST /api/auth/logout", () => {
  afterEach(() => {
    mockDeleteSession.mockReset()
  })

  it("session valide -> logout -> deleteSession appelée avec le bon token, session inutilisable", async () => {
    mockDeleteSession.mockResolvedValue(undefined)

    const response = await POST(requestWithCookie("valid-session-token"))

    expect(response.status).toBe(200)
    expect(mockDeleteSession).toHaveBeenCalledWith("valid-session-token")
    expect(mockDeleteSession).toHaveBeenCalledTimes(1)

    const body = await response.json()
    expect(body).toEqual({ status: "ok" })
  })

  it("supprime le cookie de session côté client (Set-Cookie expiré)", async () => {
    mockDeleteSession.mockResolvedValue(undefined)

    const response = await POST(requestWithCookie("valid-session-token"))

    const setCookie = response.cookies.get("hosting_session")
    expect(setCookie).toBeDefined()
    expect(setCookie?.value).toBe("")

    const setCookieHeader = response.headers.get("set-cookie")
    expect(setCookieHeader).toContain("hosting_session=")
    expect(setCookieHeader).toMatch(/Expires=Thu, 01 Jan 1970/i)
  })

  it("logout sans cookie du tout -> comportement sûr/idempotent (200, aucun appel deleteSession)", async () => {
    const response = await POST(requestWithCookie(undefined))

    expect(response.status).toBe(200)
    expect(mockDeleteSession).not.toHaveBeenCalled()

    const body = await response.json()
    expect(body).toEqual({ status: "ok" })

    // Le cookie est quand même effacé côté client, même sans cookie entrant.
    const setCookie = response.cookies.get("hosting_session")
    expect(setCookie?.value).toBe("")
  })

  it("logout avec un token déjà expiré/invalide en BDD -> comportement sûr (200)", async () => {
    /*
     * deleteSession() sur un token qui ne correspond à aucune ligne
     * (déjà expiré, déjà supprimé) est un DELETE sans effet, jamais
     * une erreur — mais on vérifie aussi que la route reste sûre même
     * si l'appel échouait pour une autre raison (DB indisponible).
     */
    mockDeleteSession.mockResolvedValue(undefined)

    const response = await POST(requestWithCookie("already-expired-token"))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: "ok" })
  })

  it("n'expose aucune information sensible même si la révocation serveur échoue", async () => {
    mockDeleteSession.mockRejectedValue(new Error("connection refused to db host 10.0.0.5:5432"))

    const response = await POST(requestWithCookie("some-token"))

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ status: "ok" })

    const bodyText = JSON.stringify(body)
    expect(bodyText).not.toContain("10.0.0.5")
    expect(bodyText).not.toContain("connection refused")

    // Le cookie est tout de même effacé côté client malgré l'échec BDD.
    const setCookie = response.cookies.get("hosting_session")
    expect(setCookie?.value).toBe("")
  })
})
