import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPool } from './db';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

async function list(): Promise<string[]> {
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith('.up.sql')).map((f) => f.replace('.up.sql', '')).sort();
}

async function ensureTable() {
  await getPool().query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
}

export async function applied(): Promise<string[]> {
  await ensureTable();
  const { rows } = await getPool().query('SELECT name FROM schema_migrations ORDER BY name');
  return rows.map((r) => r.name);
}

async function run(name: string, direction: 'up' | 'down') {
  const sql = await readFile(path.join(dir, `${name}.${direction}.sql`), 'utf8');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    if (direction === 'up') await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    else await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrateUp(): Promise<string[]> {
  const done = new Set(await applied());
  const ran: string[] = [];
  for (const name of await list()) {
    if (!done.has(name)) {
      await run(name, 'up');
      ran.push(name);
    }
  }
  return ran;
}

export async function migrateDown(steps = Infinity): Promise<string[]> {
  const done = (await applied()).reverse();
  const ran: string[] = [];
  for (const name of done.slice(0, steps)) {
    await run(name, 'down');
    ran.push(name);
  }
  return ran;
}
