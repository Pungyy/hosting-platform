import type { PoolClient } from "pg"

import type { Queryer } from "@/lib/database"
import { testPool } from "@/test/testDatabase"

/*
 * Exécute `fn` dans une transaction Postgres sur la base de test dédiée,
 * puis annule TOUJOURS la transaction (succès ou échec) — aucune fixture
 * créée par un test n'est jamais réellement persistée. Le `db` fourni à
 * `fn` est lié au même client que la transaction : les chargeurs testés
 * (getOwnedSite, getOwnedDatabase, ...) voient exactement les lignes que
 * le test vient d'insérer, avant le rollback.
 */
export async function withTestTransaction<T>(
  fn: (db: Queryer, client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await testPool.connect()

  try {
    await client.query("BEGIN")

    const db: Queryer = {
      query: (text, values) => client.query(text, values),
    }

    return await fn(db, client)
  } finally {
    await client.query("ROLLBACK")
    client.release()
  }
}
