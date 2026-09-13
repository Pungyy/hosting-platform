import { describe, expect, it } from "vitest"

import { isAdmin, requireAdmin, resolveListScope } from "@/lib/auth/roles"

describe("isAdmin", () => {
  it("renvoie true pour une session admin", () => {
    expect(isAdmin({ role: "admin" })).toBe(true)
  })

  it("renvoie false pour une session user", () => {
    expect(isAdmin({ role: "user" })).toBe(false)
  })
})

describe("requireAdmin", () => {
  it("laisse passer une session admin", () => {
    const result = requireAdmin({ role: "admin" })
    expect(result.response).toBeNull()
  })

  it("bloque une session user avec un 403 explicite", async () => {
    const result = requireAdmin({ role: "user" })

    expect(result.response).not.toBeNull()
    expect(result.response!.status).toBe(403)

    const body = await result.response!.json()
    expect(body).toEqual({
      status: "error",
      message: "Accès réservé aux administrateurs.",
    })
  })
})

describe("resolveListScope", () => {
  it("renvoie 'own' sans paramètre scope, pour un user comme pour un admin", () => {
    const request = new Request("http://localhost/api/sites")

    expect(resolveListScope(request, { role: "user" })).toEqual({
      scope: "own",
      response: null,
    })
    expect(resolveListScope(request, { role: "admin" })).toEqual({
      scope: "own",
      response: null,
    })
  })

  it("renvoie 'all' pour un admin avec ?scope=all", () => {
    const request = new Request("http://localhost/api/sites?scope=all")

    expect(resolveListScope(request, { role: "admin" })).toEqual({
      scope: "all",
      response: null,
    })
  })

  it("bloque un user avec ?scope=all (403 explicite)", async () => {
    const request = new Request("http://localhost/api/sites?scope=all")

    const result = resolveListScope(request, { role: "user" })

    expect(result.response).not.toBeNull()
    expect(result.response!.status).toBe(403)

    const body = await result.response!.json()
    expect(body.status).toBe("error")
  })
})
