import { describe, expect, it } from "vitest"

import { hostnameSchema, isValidHostname } from "./hostname.js"

describe("isValidHostname", () => {
  it("accepte un domaine valide", () => {
    expect(isValidHostname("example.com")).toBe(true)
  })

  it("accepte un sous-domaine valide", () => {
    expect(isValidHostname("docker-test.localhost")).toBe(true)
  })

  it("accepte un domaine multi-niveaux avec tirets", () => {
    expect(isValidHostname("mon-site-2.exemple.co.uk")).toBe(true)
  })

  it("rejette un backtick", () => {
    expect(isValidHostname("evil`.com")).toBe(false)
    expect(isValidHostname("a.com`) || PathPrefix(`/")).toBe(false)
  })

  it("rejette des guillemets", () => {
    expect(isValidHostname('a.com"')).toBe(false)
    expect(isValidHostname("a.com'")).toBe(false)
  })

  it("rejette des parenthèses / opérateurs de règle Traefik", () => {
    expect(isValidHostname("a.com) || PathPrefix(")).toBe(false)
    expect(isValidHostname("a.com && Host(`b.com`)")).toBe(false)
    expect(isValidHostname("a.com|b.com")).toBe(false)
    expect(isValidHostname("!a.com")).toBe(false)
  })

  it("rejette les espaces", () => {
    expect(isValidHostname("a b.com")).toBe(false)
    expect(isValidHostname(" a.com")).toBe(false)
    expect(isValidHostname("a.com ")).toBe(false)
  })

  it("rejette un slash", () => {
    expect(isValidHostname("a.com/path")).toBe(false)
    expect(isValidHostname("/a.com")).toBe(false)
  })

  it("rejette des caractères arbitraires", () => {
    expect(isValidHostname("a.com;rm -rf")).toBe(false)
    expect(isValidHostname("<script>.com")).toBe(false)
    expect(isValidHostname("a.com\n")).toBe(false)
    expect(isValidHostname("a_b.com")).toBe(false)
  })

  it("rejette un domaine vide", () => {
    expect(isValidHostname("")).toBe(false)
  })

  it("rejette un label sans TLD (pas de point)", () => {
    expect(isValidHostname("localhost")).toBe(false)
  })

  it("rejette un label commençant ou finissant par un tiret", () => {
    expect(isValidHostname("-a.com")).toBe(false)
    expect(isValidHostname("a-.com")).toBe(false)
  })
})

describe("hostnameSchema", () => {
  it("accepte un domaine valide", () => {
    const result = hostnameSchema.safeParse("example.com")
    expect(result.success).toBe(true)
  })

  it("rejette un backtick avec un message d'erreur explicite", () => {
    const result = hostnameSchema.safeParse("evil`.com")
    expect(result.success).toBe(false)
  })

  it("rejette une chaîne vide", () => {
    const result = hostnameSchema.safeParse("")
    expect(result.success).toBe(false)
  })
})
