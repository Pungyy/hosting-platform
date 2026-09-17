import { Pool } from "pg"

/*
 * Pool Postgres dédié aux tests d'intégration.
 *
 * Lit EXCLUSIVEMENT les variables TEST_DATABASE_* — aucun repli vers
 * DATABASE_* (la connexion de l'application réelle, définie dans
 * lib/database.ts). Si une seule variable manque, le module lève une
 * erreur immédiatement à l'import plutôt que de risquer une connexion
 * mal configurée.
 *
 * hosting_platform_test_user / hosting_platform_test sont un rôle et une
 * base Postgres séparés de hosting_platform_app / hosting_platform :
 *   - NOSUPERUSER, NOCREATEDB, NOCREATEROLE.
 *   - Aucun privilège sur le schéma ou les tables de hosting_platform,
 *     vérifié empiriquement (`SELECT * FROM users` échoue avec
 *     « permission denied for table users »).
 *   - Particularité connue et acceptée : ce rôle peut techniquement
 *     ouvrir une connexion à hosting_platform (CONNECT hérité de PUBLIC,
 *     jamais retiré pour ne pas risquer l'accès de hosting_platform_app)
 *     — sans que ça lui donne accès à la moindre donnée.
 *   - Ce pool n'est utilisé que par les tests, jamais par du code
 *     applicatif servant de vraies requêtes.
 */

function requireTestEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `Variable ${name} manquante. Les tests d'intégration nécessitent ` +
        "TEST_DATABASE_HOST, TEST_DATABASE_PORT, TEST_DATABASE_NAME, " +
        "TEST_DATABASE_USER et TEST_DATABASE_PASSWORD (voir " +
        "apps/panel/.env.test.example). Aucun repli vers DATABASE_* " +
        "n'est autorisé.",
    )
  }

  return value
}

export const testPool = new Pool({
  host: requireTestEnv("TEST_DATABASE_HOST"),
  port: Number(requireTestEnv("TEST_DATABASE_PORT")),
  database: requireTestEnv("TEST_DATABASE_NAME"),
  user: requireTestEnv("TEST_DATABASE_USER"),
  password: requireTestEnv("TEST_DATABASE_PASSWORD"),
})
