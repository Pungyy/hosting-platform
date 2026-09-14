import { describe, expect, it } from "vitest"

import { getBestEffortClientIp } from "@/lib/auth/request-ip"

function requestWithHeaders(headers: Record<string, string>) {
  return new Request("http://panel.local/api/auth/login", { headers })
}

describe("getBestEffortClientIp", () => {
  it("utilise la première valeur de X-Forwarded-For si présente", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2",
    })

    expect(getBestEffortClientIp(request)).toBe("203.0.113.5")
  })

  it("retombe sur X-Real-IP si X-Forwarded-For est absent", () => {
    const request = requestWithHeaders({ "x-real-ip": "198.51.100.9" })

    expect(getBestEffortClientIp(request)).toBe("198.51.100.9")
  })

  it("retourne 'unknown' si aucun en-tête n'est présent (déploiement actuel sans reverse proxy)", () => {
    const request = requestWithHeaders({})

    expect(getBestEffortClientIp(request)).toBe("unknown")
  })

  it("ignore un X-Forwarded-For vide et retombe sur X-Real-IP", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "",
      "x-real-ip": "198.51.100.9",
    })

    expect(getBestEffortClientIp(request)).toBe("198.51.100.9")
  })
})
