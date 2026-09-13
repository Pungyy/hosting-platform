/*
 * Garde-fou exécuté avant toute suite de tests : refuse de démarrer si
 * TEST_DATABASE_NAME ne ressemble pas clairement à une base de test, ou
 * s'il est identique à DATABASE_NAME (la base de développement réelle).
 * Ceci s'ajoute à testDatabase.ts (qui exige chaque variable
 * individuellement) — deux vérifications indépendantes plutôt qu'une.
 */
const testDatabaseName = process.env.TEST_DATABASE_NAME

if (!testDatabaseName || !testDatabaseName.toLowerCase().includes("test")) {
  throw new Error(
    "Refus de lancer les tests d'intégration : TEST_DATABASE_NAME " +
      `("${testDatabaseName ?? "non défini"}") ne ressemble pas à une base ` +
      "de test. Vérifiez apps/panel/.env.test.",
  )
}

if (testDatabaseName === process.env.DATABASE_NAME) {
  throw new Error(
    "Refus de lancer les tests d'intégration : TEST_DATABASE_NAME est " +
      "identique à DATABASE_NAME (la base de développement réelle).",
  )
}
