import type { Context } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../services/credentials.js", () => ({
  getAgentToken: vi.fn(),
}))

import { config } from "../config.js"
import { getAgentToken } from "../services/credentials.js"
import { requireAgentToken, requireTraefikToken } from "./auth.js"

const STATIC_TOKEN = "test-static-agent-token-0123456789abcdef"
const PERMANENT_TOKEN = "permanent-per-agent-token-fedcba9876543210"
const TRAEFIK_TOKEN = config.traefikToken

function makeContext(authorization?: string) {
  const jsonCalls: Array<{ body: unknown; status: number }> = []

  const c = {
    req: {
      header: (name: string) =>
        name === "Authorization" ? authorization : undefined,
    },
    json: (body: unknown, status: number) => {
      jsonCalls.push({ body, status })
      return { body, status }
    },
  } as unknown as Context

  return { c, jsonCalls }
}

describe("requireAgentToken", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.mocked(getAgentToken).mockReset()
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it("agent sans token permanent + AGENT_TOKEN valide -> autorisé", async () => {
    vi.mocked(getAgentToken).mockReturnValue(null)
    const next = vi.fn()
    const { c } = makeContext(`Bearer ${STATIC_TOKEN}`)

    await requireAgentToken(c, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it("agent sans token permanent + mauvais token -> refusé (401)", async () => {
    vi.mocked(getAgentToken).mockReturnValue(null)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext("Bearer un-mauvais-token")

    await requireAgentToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      { body: { status: "error", message: "Token invalide" }, status: 401 },
    ])
  })

  it("agent avec token permanent + ancien AGENT_TOKEN statique -> refusé (401)", async () => {
    /*
     * Le scénario central de la régression : une fois l'Agent
     * enrôlé, le token statique compromis/partagé ne doit plus
     * jamais fonctionner, même s'il correspond exactement à la
     * valeur configurée dans .env.
     */
    vi.mocked(getAgentToken).mockReturnValue(PERMANENT_TOKEN)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(`Bearer ${STATIC_TOKEN}`)

    await requireAgentToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      { body: { status: "error", message: "Token invalide" }, status: 401 },
    ])
  })

  it("agent avec token permanent + token propre valide -> autorisé", async () => {
    vi.mocked(getAgentToken).mockReturnValue(PERMANENT_TOKEN)
    const next = vi.fn()
    const { c } = makeContext(`Bearer ${PERMANENT_TOKEN}`)

    await requireAgentToken(c, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it("agent avec token permanent + mauvais token propre -> refusé (401)", async () => {
    vi.mocked(getAgentToken).mockReturnValue(PERMANENT_TOKEN)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext("Bearer un-mauvais-token")

    await requireAgentToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      { body: { status: "error", message: "Token invalide" }, status: 401 },
    ])
  })

  it("aucune Authorization -> 401 sans révéler le token attendu", async () => {
    vi.mocked(getAgentToken).mockReturnValue(PERMANENT_TOKEN)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(undefined)

    await requireAgentToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      {
        body: { status: "error", message: "Authentification requise" },
        status: 401,
      },
    ])
  })

  it("schéma d'authentification invalide (non Bearer) -> 401", async () => {
    vi.mocked(getAgentToken).mockReturnValue(null)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(`Basic ${STATIC_TOKEN}`)

    await requireAgentToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls[0].status).toBe(401)
  })

  it("ne loggue et n'expose jamais le token ou le token permanent, y compris en cas de refus", async () => {
    vi.mocked(getAgentToken).mockReturnValue(PERMANENT_TOKEN)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(`Bearer ${STATIC_TOKEN}`)

    await requireAgentToken(c, next)

    const responseText = JSON.stringify(jsonCalls)
    expect(responseText).not.toContain(STATIC_TOKEN)
    expect(responseText).not.toContain(PERMANENT_TOKEN)

    const allLoggedArgs = [
      ...consoleLogSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .map((arg) => JSON.stringify(arg))
      .join("\n")

    expect(allLoggedArgs).not.toContain(STATIC_TOKEN)
    expect(allLoggedArgs).not.toContain(PERMANENT_TOKEN)
  })

  it("TRAEFIK_TOKEN présenté sur une route normale (ex. /sites) -> refusé (401)", async () => {
    /*
     * TRAEFIK_TOKEN est un secret à part, réservé à GET
     * /traefik/config (voir requireTraefikToken ci-dessous).
     * requireAgentToken ne doit jamais l'accepter, ni sans agent
     * enrôlé ni avec.
     */
    vi.mocked(getAgentToken).mockReturnValue(null)
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(`Bearer ${TRAEFIK_TOKEN}`)

    await requireAgentToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      { body: { status: "error", message: "Token invalide" }, status: 401 },
    ])
  })
})

describe("requireTraefikToken", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it("TRAEFIK_TOKEN valide -> autorisé", async () => {
    const next = vi.fn()
    const { c } = makeContext(`Bearer ${TRAEFIK_TOKEN}`)

    await requireTraefikToken(c, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it("mauvais token Traefik -> refusé (401)", async () => {
    const next = vi.fn()
    const { c, jsonCalls } = makeContext("Bearer un-mauvais-token")

    await requireTraefikToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      { body: { status: "error", message: "Token invalide" }, status: 401 },
    ])
  })

  it("l'AGENT_TOKEN statique est refusé sur /traefik/config", async () => {
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(`Bearer ${STATIC_TOKEN}`)

    await requireTraefikToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls[0].status).toBe(401)
  })

  it("le token permanent de l'Agent est refusé sur /traefik/config (séparation stricte des rôles)", async () => {
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(`Bearer ${PERMANENT_TOKEN}`)

    await requireTraefikToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls[0].status).toBe(401)
  })

  it("aucune Authorization -> 401", async () => {
    const next = vi.fn()
    const { c, jsonCalls } = makeContext(undefined)

    await requireTraefikToken(c, next)

    expect(next).not.toHaveBeenCalled()
    expect(jsonCalls).toEqual([
      {
        body: { status: "error", message: "Authentification requise" },
        status: 401,
      },
    ])
  })

  it("ne loggue et n'expose jamais TRAEFIK_TOKEN, y compris en cas de refus", async () => {
    const next = vi.fn()
    const { c, jsonCalls } = makeContext("Bearer un-mauvais-token")

    await requireTraefikToken(c, next)

    const responseText = JSON.stringify(jsonCalls)
    expect(responseText).not.toContain(TRAEFIK_TOKEN)

    const allLoggedArgs = [
      ...consoleLogSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .map((arg) => JSON.stringify(arg))
      .join("\n")

    expect(allLoggedArgs).not.toContain(TRAEFIK_TOKEN)
  })
})
