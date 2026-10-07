import pg from 'pg';
import { config } from './config';

// Return JSON/JSONB as objects and bigint counts as numbers.
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
}
