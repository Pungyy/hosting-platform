/*
 * Nom du cookie de session.
 *
 * Isolé dans son propre module (sans dépendance à `pg` / `node:crypto`)
 * pour pouvoir être importé depuis `proxy.ts`.
 */
export const SESSION_COOKIE_NAME = "hosting_session"
