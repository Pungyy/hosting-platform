import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import proxy from "./proxy"

const SESSION_COOKIE = "hosting_session"

function requestFor(pathname: string, { withSession = false } = {}) {
  return new NextRequest(`http://panel.local${pathname}`, {
    headers: withSession
      ? { cookie: `${SESSION_COOKIE}=some-token` }
      : undefined,
  })
}

describe("proxy (middleware) — routage public/protégé", () => {
  it("/login est accessible sans session (page publique)", () => {
    const response = proxy(requestFor("/login"))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("/register est accessible sans session (page publique)", () => {
    const response = proxy(requestFor("/register"))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("POST /api/auth/register est accessible sans session (route API publique)", () => {
    const response = proxy(requestFor("/api/auth/register"))

    expect(response.status).toBe(200)
  })

  it("un utilisateur déjà authentifié visitant /login est renvoyé vers /", () => {
    const response = proxy(requestFor("/login", { withSession: true }))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://panel.local/")
  })

  it("un utilisateur déjà authentifié visitant /register est renvoyé vers /", () => {
    const response = proxy(requestFor("/register", { withSession: true }))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://panel.local/")
  })

  it("une page protégée reste protégée : sans session -> redirection vers /login", () => {
    const response = proxy(requestFor("/sites"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://panel.local/login")
  })

  it("une page protégée reste accessible avec une session présente", () => {
    const response = proxy(requestFor("/sites", { withSession: true }))

    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
  })

  it("une route API protégée reste protégée : sans session -> 401 JSON, jamais une redirection HTML", async () => {
    const response = proxy(requestFor("/api/sites"))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toEqual({
      status: "error",
      message: "Authentification requise.",
    })
  })

  it("une route API protégée reste accessible avec une session présente", () => {
    const response = proxy(requestFor("/api/sites", { withSession: true }))

    expect(response.status).toBe(200)
  })
})
