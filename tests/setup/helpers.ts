import { query } from '../../packages/core/src/db';
import { createUser, createWorkspace, type User } from '../../packages/core/src/users';
import { signSession } from '../../packages/core/src/auth';
import { redis } from '../../packages/core/src/queue';

export async function resetDb() {
  const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'")).map((r) => `"${r.tablename}"`);
  if (tables.length) await query(`TRUNCATE ${tables.join(', ')} CASCADE`);
}

export async function resetRedis() {
  const keys = await redis().keys('mockups-test*');
  if (keys.length) await redis().del(...keys);
}

let n = 0;
export async function makeUser(role: 'admin' | 'member' = 'member', workspaceId?: string): Promise<User & { token: string }> {
  const ws = workspaceId ?? (await createWorkspace('Test WS')).id;
  const user = await createUser({ workspaceId: ws, name: `User ${++n}`, email: `u${n}-${Date.now()}@test.dev`, password: 'secret123', role });
  return { ...user, token: signSession(user.id) };
}

export const auth = (u: { token: string }) => ({ authorization: `Bearer ${u.token}` });

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 20_000, everyMs = 50): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
