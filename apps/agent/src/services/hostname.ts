import { z } from "zod"

/*
 * Format hostname strict — DOIT rester identique à `isValidDomain()` côté
 * Panel (apps/panel/src/app/api/sites/[id]/domains/route.ts). Le Panel est
 * aujourd'hui l'unique appelant de PUT /sites/:name/domains et valide déjà
 * ce format avant d'appeler l'Agent, mais cette route reste une frontière
 * de confiance à part entière (protégée par un token Agent, pas par la
 * logique du Panel) : `domain` finit interpolé sans échappement dans une
 * règle Traefik (`Host(\`${domain}\`)`, voir services/traefik.ts) — un
 * domaine contenant un backtick ou un opérateur de règle Traefik
 * (`|`, `&`, `!`, parenthèses...) pourrait sinon injecter une règle de
 * routage affectant d'autres tenants. Seuls des labels alphanumériques
 * (+ tiret, jamais en tête/fin de label) séparés par des points, terminés
 * par un label final alphabétique de 2 à 63 caractères, sont acceptés —
 * strictement aucun backtick, espace, slash, guillemet ou opérateur.
 */
const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/

export function isValidHostname(value: string): boolean {
  return HOSTNAME_REGEX.test(value)
}

export const hostnameSchema = z
  .string()
  .min(1, "Le domaine est obligatoire.")
  .refine(isValidHostname, {
    message: "Format de domaine invalide.",
  })
