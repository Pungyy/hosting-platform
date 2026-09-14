import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiErrorResponse } from "@/lib/http/api-error"

describe("ApiError", () => {
  it("stocke le message et le status fournis", () => {
    const error = new ApiError("Un site doit conserver au moins un domaine.", 409)

    expect(error.message).toBe("Un site doit conserver au moins un domaine.")
    expect(error.status).toBe(409)
    expect(error.name).toBe("ApiError")
    expect(error).toBeInstanceOf(Error)
  })

  it("utilise 400 comme status par défaut", () => {
    const error = new ApiError("Données invalides.")

    expect(error.status).toBe(400)
  })
})

describe("apiErrorResponse", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it("renvoie le message et le status exacts d'une ApiError", async () => {
    const error = new ApiError("Un site doit conserver au moins un domaine.", 409)

    const response = apiErrorResponse(
      error,
      "DELETE /api/sites/[id]/domains/[domainId] error:",
      "Impossible de supprimer le domaine.",
    )

    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body).toEqual({
      status: "error",
      message: "Un site doit conserver au moins un domaine.",
    })
  })

  it("remplace le message d'une Error générique (Postgres, réseau...) par le fallback sûr", async () => {
    const rawError = new Error(
      "duplicate key value violates unique constraint \"sites_name_key\"",
    )

    const response = apiErrorResponse(
      rawError,
      "POST /api/sites error:",
      "Impossible de créer le site.",
    )

    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body).toEqual({
      status: "error",
      message: "Impossible de créer le site.",
    })
    expect(body.message).not.toContain("constraint")
  })

  it("remplace le message d'une erreur réseau Agent brute par le fallback sûr", async () => {
    const rawError = new Error(
      "Impossible de joindre l'Agent : connect ECONNREFUSED 172.18.0.5:4000",
    )

    const response = apiErrorResponse(
      rawError,
      "POST /api/sites/[id]/action (agent) error:",
      "L'Agent a refusé l'action.",
      502,
    )

    expect(response.status).toBe(502)

    const body = await response.json()
    expect(body.message).toBe("L'Agent a refusé l'action.")
    expect(body.message).not.toContain("172.18")
    expect(body.message).not.toContain("ECONNREFUSED")
  })

  it("utilise le fallback sûr pour une valeur qui n'est pas une Error", async () => {
    const response = apiErrorResponse(
      "chaîne brute inattendue",
      "GET /api/sites error:",
      "Impossible de récupérer les sites.",
    )

    const body = await response.json()
    expect(body.message).toBe("Impossible de récupérer les sites.")
  })

  it("utilise 500 comme status par défaut pour une erreur non-ApiError", () => {
    const response = apiErrorResponse(
      new Error("boom"),
      "GET /api/sites error:",
      "Impossible de récupérer les sites.",
    )

    expect(response.status).toBe(500)
  })

  it("loggue toujours le contexte et l'erreur brute côté serveur, même pour une ApiError", () => {
    const error = new ApiError("Message sûr.", 400)

    apiErrorResponse(error, "CONTEXTE-TEST", "fallback")

    expect(consoleErrorSpy).toHaveBeenCalledWith("CONTEXTE-TEST", error)
  })

  it("loggue l'erreur brute complète (pas seulement le fallback) pour une erreur interne", () => {
    const rawError = new Error("SELECT failed: relation \"sites\" does not exist")

    apiErrorResponse(rawError, "CONTEXTE-TEST-2", "Impossible de créer le site.")

    expect(consoleErrorSpy).toHaveBeenCalledWith("CONTEXTE-TEST-2", rawError)
  })
})
