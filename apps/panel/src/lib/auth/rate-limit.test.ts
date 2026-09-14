import { describe, expect, it } from "vitest"

import { RateLimiter } from "@/lib/auth/rate-limit"

const WINDOW_MS = 60_000

describe("RateLimiter", () => {
  it("autorise les tentatives sous la limite", () => {
    const limiter = new RateLimiter(3, WINDOW_MS)
    const now = 1_000_000

    expect(limiter.check("a", now).allowed).toBe(true)
    expect(limiter.check("a", now).allowed).toBe(true)
    expect(limiter.check("a", now).allowed).toBe(true)
  })

  it("refuse une fois la limite dépassée (429 côté appelant)", () => {
    const limiter = new RateLimiter(3, WINDOW_MS)
    const now = 1_000_000

    limiter.check("a", now)
    limiter.check("a", now)
    limiter.check("a", now)

    const result = limiter.check("a", now)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it("une fenêtre qui expire redevient autorisée", () => {
    const limiter = new RateLimiter(2, WINDOW_MS)
    const start = 1_000_000

    limiter.check("a", start)
    limiter.check("a", start)
    expect(limiter.check("a", start).allowed).toBe(false)

    const afterWindow = start + WINDOW_MS + 1

    expect(limiter.check("a", afterWindow).allowed).toBe(true)
  })

  it("applique des compteurs indépendants par clé (IP vs email)", () => {
    const limiter = new RateLimiter(1, WINDOW_MS)
    const now = 1_000_000

    expect(limiter.check("email-a@example.com", now).allowed).toBe(true)
    expect(limiter.check("email-a@example.com", now).allowed).toBe(false)

    // Clé différente (ex. une autre IP ou un autre email) : compteur
    // totalement indépendant, non affecté par l'épuisement de la première.
    expect(limiter.check("email-b@example.com", now).allowed).toBe(true)
    expect(limiter.check("203.0.113.5", now).allowed).toBe(true)
  })

  it("reset() vide le compteur d'une clé", () => {
    const limiter = new RateLimiter(1, WINDOW_MS)
    const now = 1_000_000

    limiter.check("a", now)
    expect(limiter.check("a", now).allowed).toBe(false)

    limiter.reset("a")

    expect(limiter.check("a", now).allowed).toBe(true)
  })

  it("reset() sur une clé inconnue ne lève pas d'exception", () => {
    const limiter = new RateLimiter(1, WINDOW_MS)
    expect(() => limiter.reset("jamais-vue")).not.toThrow()
  })

  it("mémoire bornée : nettoie les entrées expirées lors d'un appel après la fenêtre", () => {
    const limiter = new RateLimiter(5, WINDOW_MS)
    const start = 1_000_000

    for (let i = 0; i < 50; i++) {
      limiter.check(`key-${i}`, start)
    }

    expect(limiter.size).toBe(50)

    /*
     * Le nettoyage est déclenché lors du PROCHAIN appel à check(), une
     * fois qu'une fenêtre complète s'est écoulée depuis le dernier
     * nettoyage — pas de timer d'arrière-plan.
     */
    const afterWindow = start + WINDOW_MS + 1
    limiter.check("nouvelle-clef", afterWindow)

    // Toutes les entrées expirées ont été purgées ; seule la nouvelle reste.
    expect(limiter.size).toBe(1)
  })

  it("ne purge pas une clé encore active lors du nettoyage périodique", () => {
    const limiter = new RateLimiter(2, WINDOW_MS)
    const start = 1_000_000

    // Premier appel : initialise aussi l'horodatage de référence du nettoyage.
    limiter.check("old-key", start)

    // Créée à mi-fenêtre : son `resetAt` est bien après celui de "old-key".
    const midWindow = start + WINDOW_MS / 2
    limiter.check("fresh-key", midWindow)

    // Déclenche le balayage (une fenêtre complète s'est écoulée depuis `start`).
    const afterWindow = start + WINDOW_MS + 1
    limiter.check("sweep-trigger", afterWindow)

    // "old-key" a bien été purgée (fenêtre expirée avant le balayage).
    expect(limiter.check("old-key", afterWindow).allowed).toBe(true) // recréée à zéro

    // "fresh-key" doit avoir SURVÉCU au balayage avec son compteur intact
    // (1 tentative déjà comptée) : une 2e tentative est encore autorisée,
    // une 3e doit être refusée — si le balayage l'avait purgée à tort, le
    // compteur serait reparti de zéro et la 3e serait encore autorisée.
    expect(limiter.check("fresh-key", afterWindow).allowed).toBe(true)
    expect(limiter.check("fresh-key", afterWindow).allowed).toBe(false)
  })
})
