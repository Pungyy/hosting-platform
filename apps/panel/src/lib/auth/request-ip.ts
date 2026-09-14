/*
 * Extraction "best-effort" de l'IP cliente pour le rate limiting du login.
 *
 * IMPORTANT — analyse faite avant implémentation (finding P1 #3) :
 * ce Panel tourne aujourd'hui SANS reverse proxy devant lui (`next dev`/
 * `next start` directement — vérifié : aucun compose.yaml, aucune route
 * Traefik pour le Panel lui-même, contrairement aux sites tenants qui
 * eux sont routés par Traefik/l'Agent). Il n'existe donc AUCUN hop de
 * confiance configuré qui garantirait/normaliserait `X-Forwarded-For`
 * ou `X-Real-IP` : n'importe quel client connecté directement peut
 * fournir la valeur de son choix pour ces en-têtes.
 *
 * Par ailleurs, l'objet `Request`/`NextRequest` standard des route
 * handlers Next.js (App Router) n'expose pas l'adresse socket TCP brute
 * (limitation connue de Next.js en self-hosting — c'est d'ailleurs la
 * raison pour laquelle `NextRequest.ip` a été dépréciée puis retirée).
 * Il n'existe donc PAS de source d'IP réellement fiable disponible ici.
 *
 * Conséquence sur la conception du rate limiter (voir login/route.ts) :
 * cette fonction ne doit JAMAIS être traitée comme une source d'identité
 * ou d'autorisation, uniquement comme une clé de regroupement best-effort
 * pour une limite généreuse et secondaire (repérer une seule source non
 * authentifiée qui arrose beaucoup d'emails différents). La protection
 * réelle contre le brute-force d'un compte connu repose sur la clé EMAIL
 * (voir route.ts), qui n'est pas contournable en changeant cet en-tête.
 *
 * Si ce Panel est un jour déployé derrière un reverse proxy de confiance
 * (ex. Traefik en TLS termination devant lui, comme c'est déjà le cas
 * pour les sites tenants), cette fonction DOIT être revue : ne faire
 * confiance qu'à l'en-tête effectivement écrasé par CE proxy (jamais une
 * valeur arbitraire côté client), avec un nombre de hops de confiance
 * explicite plutôt que de prendre la première valeur venue.
 */
export function getBestEffortClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")

  if (forwardedFor) {
    const firstEntry = forwardedFor.split(",")[0]?.trim()

    if (firstEntry) {
      return firstEntry
    }
  }

  const realIp = request.headers.get("x-real-ip")

  if (realIp) {
    return realIp.trim()
  }

  return "unknown"
}
