/*
 * Limiteur de débit générique en mémoire (fenêtre fixe par clé, avec
 * expiration paresseuse). Adapté à une instance Panel unique — voir
 * l'usage dans app/api/auth/login/route.ts pour le contexte et les
 * limites de cette approche en cas de scaling horizontal.
 */
export type RateLimitResult = {
  allowed: boolean
  /* Millisecondes avant que la fenêtre courante n'expire. */
  retryAfterMs: number
}

type Bucket = {
  count: number
  resetAt: number
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  /*
   * Initialisé paresseusement au premier appel à check() (avec le `now`
   * effectivement fourni à cet appel, réel ou injecté) plutôt qu'à la
   * construction : sinon, un appelant qui contrôle `now` (tests, ou
   * tout usage avec une horloge synthétique) verrait `now - lastCleanup`
   * rester négatif indéfiniment et le nettoyage ne se déclencherait
   * jamais.
   */
  private lastCleanup: number | null = null

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /*
   * Nombre de clés actuellement suivies — exposé uniquement pour les
   * tests (vérifier que le nettoyage borne bien la mémoire).
   */
  get size(): number {
    return this.buckets.size
  }

  check(key: string, now: number = Date.now()): RateLimitResult {
    this.maybeCleanup(now)

    const bucket = this.buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
      return { allowed: true, retryAfterMs: this.windowMs }
    }

    if (bucket.count < this.limit) {
      bucket.count += 1
      return { allowed: true, retryAfterMs: bucket.resetAt - now }
    }

    return { allowed: false, retryAfterMs: bucket.resetAt - now }
  }

  /*
   * Remise à zéro explicite d'une clé — appelée après une authentification
   * réussie pour ne pas pénaliser l'usage légitime futur à cause de
   * précédentes tentatives ratées (fautes de frappe, etc.).
   */
  reset(key: string): void {
    this.buckets.delete(key)
  }

  /*
   * Borne la mémoire sans timer d'arrière-plan : à chaque appel, si plus
   * d'une fenêtre s'est écoulée depuis le dernier nettoyage, on purge
   * toutes les entrées expirées. Suffisant ici (le processus Panel reste
   * un serveur long-vivant qui reçoit un flux régulier de requêtes de
   * connexion) — pas besoin de setInterval, qui compliquerait les tests
   * et laisserait un timer actif indéfiniment.
   */
  private maybeCleanup(now: number): void {
    if (this.lastCleanup === null) {
      this.lastCleanup = now
      return
    }

    if (now - this.lastCleanup < this.windowMs) {
      return
    }

    this.lastCleanup = now

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key)
      }
    }
  }
}
