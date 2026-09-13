import { NextResponse } from "next/server"

/*
 * Réponse "introuvable" partagée par tous les chargeurs de ressources
 * (lib/resources/*). Un seul point d'implémentation garantit que le cas
 * "n'existe pas" et le cas "existe mais n'est pas à vous" renvoient
 * exactement le même corps JSON et le même statut — jamais un 403 qui
 * confirmerait l'existence d'un identifiant à un attaquant qui teste des
 * UUID au hasard.
 */
export function notFoundResponse(message: string): NextResponse {
  return NextResponse.json({ status: "error", message }, { status: 404 })
}
