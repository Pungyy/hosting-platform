import { describe, expect, it } from "vitest"

import nextConfig from "./next.config"

describe("next.config headers() — en-têtes de sécurité (M7)", () => {
  it("applique les en-têtes de sécurité à toutes les routes", async () => {
    const rules = await nextConfig.headers!()

    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe("/:path*")

    const headerNames = rules[0].headers.map((h) => h.key)
    expect(headerNames).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Content-Security-Policy",
      ]),
    )
  })

  it("bloque l'embarquement en iframe (X-Frame-Options + frame-ancestors)", async () => {
    const rules = await nextConfig.headers!()
    const headers = rules[0].headers

    const xFrameOptions = headers.find((h) => h.key === "X-Frame-Options")
    expect(xFrameOptions?.value).toBe("DENY")

    const csp = headers.find((h) => h.key === "Content-Security-Policy")
    expect(csp?.value).toContain("frame-ancestors 'none'")
  })

  it("force nosniff sur le type MIME", async () => {
    const rules = await nextConfig.headers!()
    const headers = rules[0].headers

    const nosniff = headers.find((h) => h.key === "X-Content-Type-Options")
    expect(nosniff?.value).toBe("nosniff")
  })

  it("HSTS couvre les sous-domaines sans preload (décision séparée)", async () => {
    const rules = await nextConfig.headers!()
    const headers = rules[0].headers

    const hsts = headers.find((h) => h.key === "Strict-Transport-Security")
    expect(hsts?.value).toContain("includeSubDomains")
    expect(hsts?.value).not.toContain("preload")
  })

  it("la CSP n'autorise que 'self' comme origine par défaut (aucune ressource tierce)", async () => {
    const rules = await nextConfig.headers!()
    const headers = rules[0].headers

    const csp = headers.find((h) => h.key === "Content-Security-Policy")
    expect(csp?.value).toContain("default-src 'self'")
    expect(csp?.value).toContain("object-src 'none'")
    expect(csp?.value).toContain("connect-src 'self'")
  })

  it("Permissions-Policy désactive les APIs sensibles non utilisées par le Panel", async () => {
    const rules = await nextConfig.headers!()
    const headers = rules[0].headers

    const permissionsPolicy = headers.find(
      (h) => h.key === "Permissions-Policy",
    )
    expect(permissionsPolicy?.value).toContain("camera=()")
    expect(permissionsPolicy?.value).toContain("microphone=()")
    expect(permissionsPolicy?.value).toContain("geolocation=()")
  })
})
