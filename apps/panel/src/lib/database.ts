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

export async function checkDatabaseConnection() {
  const result = await pool.query("SELECT NOW()")

  return result.rows[0]
}

export { pool }