import { Pool, type QueryResultRow } from "pg"

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
})

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) {
  return pool.query<T>(text, values)
}

/*
 * Contrat minimal partagé par le pool de production (`query` ci-dessus) et
 * le client de transaction utilisé par les tests d'intégration
 * (apps/panel/src/test/withTestTransaction.ts) — permet aux chargeurs de
 * lib/resources/* d'accepter en option une source de requêtes différente
 * sans dépendre directement du pool applicatif.
 */
export type Queryer = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>
}

export { pool }