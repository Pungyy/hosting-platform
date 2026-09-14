import { NextResponse } from "next/server"

/*
 * Erreur explicitement destinée à être affichée au client : message choisi
 * par le code applicatif (validation, règle métier), jamais une exception
 * de bibliothèque (pg, fetch, fs...) ou un message relayé par l'Agent tel
 * quel (l'Agent a le même risque de fuite que le Panel — voir
 * apps/agent/src/controllers/*.ts — son `message` n'est donc pas considéré
 * comme sûr par défaut).
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/*
 * Point de sortie centralisé pour le catch d'une route API :
 * - loggue toujours l'erreur complète côté serveur (contexte + erreur brute)
 * - ne renvoie au client QUE le message d'une ApiError explicite ; toute
 *   autre erreur (Postgres, Agent, réseau, filesystem...) est remplacée par
 *   un message générique sûr, pour ne jamais exposer de détail interne
 *   (stack, SQL, chemins, erreurs Docker/Agent, credentials...).
 */
export function apiErrorResponse(
  error: unknown,
  context: string,
  fallbackMessage: string,
  fallbackStatus = 500,
): NextResponse {
  console.error(context, error)

  if (error instanceof ApiError) {
    return NextResponse.json(
      { status: "error", message: error.message },
      { status: error.status },
    )
  }

  return NextResponse.json(
    { status: "error", message: fallbackMessage },
    { status: fallbackStatus },
  )
}
