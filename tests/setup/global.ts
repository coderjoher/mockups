import './env';
import { migrateDown, migrateUp } from '../../packages/core/src/migrate';
import { closePool } from '../../packages/core/src/db';
import { rm } from 'node:fs/promises';

// Fresh schema once per run; individual tests clean the tables they touch.
export async function setup() {
  await migrateDown();
  await migrateUp();
  await closePool();
  await rm(process.env.STORAGE_DIR!, { recursive: true, force: true });
}
