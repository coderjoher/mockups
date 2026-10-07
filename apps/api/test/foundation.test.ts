import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { closePool } from '@mockups/core/db';
import { closeQueues, enqueue } from '@mockups/core/queue';
import { getStorage } from '@mockups/core/storage';
import { auth, makeUser, resetDb } from '../../../tests/setup/helpers';

let app: FastifyInstance;
beforeAll(async () => {
  await resetDb();
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await closeQueues();
  await closePool();
});

describe('[F-1] API service boots', () => {
  it('answers /health', async () => {
    const res = await app.inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('API auth', () => {
  it('logs in with a password, sets a session cookie and rejects bad passwords', async () => {
    const u = await makeUser('member');
    const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email, password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: u.email.toUpperCase(), password: 'secret123' } });
    expect(ok.statusCode).toBe(200);
    const sid = ok.cookies.find((c) => c.name === 'sid')!;
    expect(sid.httpOnly).toBe(true);
    const me = await app.inject({ url: '/me', cookies: { sid: sid.value } });
    expect(me.json().user.email).toBe(u.email);
    expect((await app.inject('/me')).statusCode).toBe(401);
    const out = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(out.statusCode).toBe(200);
  });

  it('shows job status to its workspace only', async () => {
    const u = await makeUser('member');
    const other = await makeUser('member');
    const project = (await (await import('@mockups/core/db')).one('INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,$3) RETURNING id', [u.workspace_id, u.id, 'https://a.test/']))!;
    const id = await enqueue('discover', { x: 1 }, project.id);
    expect((await app.inject({ url: `/jobs/${id}`, headers: auth(u) })).json().job.status).toBe('queued');
    expect((await app.inject({ url: `/jobs/${id}`, headers: auth(other) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/jobs/not-a-uuid`, headers: auth(u) })).statusCode).toBe(404);
  });
});

describe('[F-6] signed file URLs over HTTP', () => {
  it('serves a file through its signed URL and refuses tampered or expired links', async () => {
    await getStorage().put('t/hello.txt', Buffer.from('hi'));
    const url = new URL(await getStorage().signedUrl('t/hello.txt', 60));
    const ok = await app.inject(url.pathname + url.search);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('hi');
    url.searchParams.set('sig', 'x' + url.searchParams.get('sig')!.slice(1));
    expect((await app.inject(url.pathname + url.search)).statusCode).toBe(403);
    expect((await app.inject('/files/t/hello.txt?exp=1&sig=abc')).statusCode).toBe(403);
  });
});
