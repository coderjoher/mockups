import { migrateUp } from '../../packages/core/src/migrate';
import { closePool, query } from '../../packages/core/src/db';
import { createUser, createWorkspace } from '../../packages/core/src/users';
import { redis, closeQueues } from '../../packages/core/src/queue';

export const ADMIN = { email: 'admin@e2e.test', password: 'admin-pass-1' };
export const MEMBER = { email: 'member@e2e.test', password: 'member-pass-1' };

export default async function globalSetup() {
  await migrateUp();
  const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'")).map((r) => `"${r.tablename}"`);
  await query(`TRUNCATE ${tables.join(', ')} CASCADE`);
  const keys = await redis().keys('mockups-e2e*');
  if (keys.length) await redis().del(...keys);
  const ws = await createWorkspace('E2E');
  await createUser({ workspaceId: ws.id, name: 'Admin', ...ADMIN, role: 'admin' });
  await createUser({ workspaceId: ws.id, name: 'Member', ...MEMBER, role: 'member' });
  await closeQueues();
  await closePool();
}
