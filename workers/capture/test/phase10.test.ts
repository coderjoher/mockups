import Ajv from 'ajv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildApp } from '../../../apps/api/src/app';
import { OPENAPI, SCHEMAS } from '../../../apps/api/src/openapi';
import { closePool, one, query } from '@mockups/core/db';
import { closeQueues, redis, startWorker } from '@mockups/core/queue';
import { createApiKey } from '@mockups/core/apikeys';
import { signWebhook } from '@mockups/core/plans';
import { desiredWorkers } from '@mockups/core/scale';
import { handlers } from '../src/handlers';
import { closeBrowser } from '../src/browser';
import { startFixtures } from '../../../tests/setup/fixtures';
import { auth, makeUser, resetDb, resetRedis, waitFor } from '../../../tests/setup/helpers';
import { colourShare, decode } from '../../../tests/setup/png';
import { getStorage } from '@mockups/core/storage';

let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof startFixtures>>;
let worker: Worker;
beforeAll(async () => {
  fx = await startFixtures();
  app = await buildApp();
  worker = startWorker('capture', handlers.capture, { concurrency: 3 });
});
beforeEach(async () => {
  await resetDb();
  await resetRedis();
});
afterAll(async () => {
  await worker.close();
  await closeBrowser();
  fx.server.close();
  await app.close();
  await closeQueues();
  await closePool();
});

const ajv = new Ajv({ strict: false });
const valid = (schema: object, data: unknown) => {
  const v = ajv.compile(schema);
  if (!v(data)) throw new Error(JSON.stringify(v.errors));
  return true;
};
const key = (k: string) => ({ authorization: `Bearer ${k}` });

describe('[SC-2] public API', () => {
  it('works end to end with an API key and matches the OpenAPI contract', async () => {
    const u = await makeUser();
    const { key: k } = await createApiKey(u.id, 'CI');
    const spec = (await app.inject('/v1/openapi.json')).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toContain('/projects/{id}/captures');

    const created = await app.inject({ method: 'POST', url: '/v1/projects', headers: key(k), payload: { url: fx.url('capture') } });
    expect(created.statusCode).toBe(201);
    valid(OPENAPI.paths['/projects'].post.responses[201].content['application/json'].schema, created.json());
    const id = created.json().project.id;
    const list = (await app.inject({ url: '/v1/projects', headers: key(k) })).json();
    valid(OPENAPI.paths['/projects'].get.responses[200].content['application/json'].schema, list);
    const pages = (await app.inject({ url: `/v1/projects/${id}/pages`, headers: key(k) })).json();
    valid(OPENAPI.paths['/projects/{id}/pages'].get.responses[200].content['application/json'].schema, pages);
    const started = await app.inject({ method: 'POST', url: `/v1/projects/${id}/captures`, headers: key(k), payload: { devices: ['mobile'] } });
    expect(started.statusCode).toBe(202);
    valid({ type: 'object', properties: { captures: { type: 'array', items: SCHEMAS.capture } } }, started.json());
    const done = await waitFor(async () => {
      const c = (await app.inject({ url: `/v1/projects/${id}/captures`, headers: key(k) })).json().captures;
      return c[0]?.status === 'done' && c;
    }, 60_000);
    valid(SCHEMAS.capture, done[0]);
    const mockups = (await app.inject({ url: '/v1/mockups', headers: key(k) })).json();
    valid(OPENAPI.paths['/mockups'].get.responses[200].content['application/json'].schema, mockups);
  });

  it('needs a valid key (sessions do not count), and admin routes are not exposed', async () => {
    const admin = await makeUser('admin');
    expect((await app.inject({ url: '/v1/projects', headers: auth(admin) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/v1/projects', headers: key('mk_nope') })).json().error).toBe('bad_api_key');
    const { key: k, id } = await createApiKey(admin.id, 'x');
    expect((await app.inject({ url: '/v1/admin/mockups', headers: key(k) })).statusCode).toBe(404);
    await app.inject({ method: 'DELETE', url: `/api-keys/${id}`, headers: auth(admin) });
    expect((await app.inject({ url: '/v1/projects', headers: key(k) })).statusCode).toBe(401);
  });

  it('rate limits per key', async () => {
    const u = await makeUser();
    const { key: k } = await createApiKey(u.id, 'tight', 3);
    const { key: other } = await createApiKey(u.id, 'other', 3);
    for (let i = 0; i < 3; i++) expect((await app.inject({ url: '/v1/projects', headers: key(k) })).statusCode).toBe(200);
    const limited = await app.inject({ url: '/v1/projects', headers: key(k) });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({ url: '/v1/projects', headers: key(other) })).statusCode).toBe(200);
  });

  it('[NF-SSRF] runs the SSRF guard through the API too', async () => {
    const u = await makeUser();
    const { key: k } = await createApiKey(u.id, 'x');
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/', fx.url('redirects', '/to-metadata')]) {
      const res = await app.inject({ method: 'POST', url: '/v1/projects', headers: key(k), payload: { url } });
      expect(res.json().error).toBe('blocked_url');
    }
  });

  it('creates, lists and revokes keys from the web app; the key is shown once', async () => {
    const u = await makeUser();
    const res = await app.inject({ method: 'POST', url: '/api-keys', headers: auth(u), payload: { name: 'Zapier' } });
    expect(res.json().key).toMatch(/^mk_/);
    const listed = (await app.inject({ url: '/api-keys', headers: auth(u) })).json().keys;
    expect(listed[0]).toMatchObject({ name: 'Zapier', prefix: res.json().key.slice(0, 10) });
    expect(JSON.stringify(listed)).not.toContain(res.json().key);
  });
});

describe('[SC-1] logged-in capture with a session cookie', () => {
  it('uses the cookie for that capture only and never stores it', async () => {
    const u = await makeUser();
    const { project } = (await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('members') } })).json();
    const secret = 'let-me-in-9f3c';
    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u),
      payload: { devices: ['desktop'], sessionCookie: { name: 'session', value: secret } },
    });
    expect(res.statusCode).toBe(202);
    const caps = await waitFor(async () => {
      const c = (await app.inject({ url: `/projects/${project.id}/captures`, headers: auth(u) })).json().captures;
      return c[0]?.status === 'done' && c;
    }, 60_000);
    const png = decode(await getStorage().get((await one('SELECT image_key FROM captures WHERE id = $1', [caps[0].id])).image_key));
    expect(colourShare(png, [22, 163, 74], 6)).toBeGreaterThan(0.3); // the members-only (green) page
    // Not in Postgres, not left in Redis.
    for (const t of ['captures', 'jobs', 'pages', 'projects', 'domain_log']) {
      const rows = await query(`SELECT * FROM ${t}`);
      expect(JSON.stringify(rows)).not.toContain(secret);
    }
    expect((await redis().keys('*session*')).length).toBe(0);
    expect((await one('SELECT cache_key FROM captures WHERE id = $1', [caps[0].id])).cache_key).toBeNull();
    // A capture without the cookie sees the login wall (red), and is not served from a logged-in cache.
    const before = (await one('SELECT image_key FROM captures WHERE id = $1', [caps[0].id])).image_key;
    await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/recapture`, headers: auth(u) });
    const again = await waitFor(async () => {
      const row = await one("SELECT image_key FROM captures WHERE id = $1 AND status = 'done'", [caps[0].id]);
      return row && row.image_key !== before && row;
    }, 60_000);
    const wall = decode(await getStorage().get(again.image_key));
    expect(colourShare(wall, [220, 38, 38], 6)).toBeGreaterThan(0.3);
  });

  it('rejects malformed cookies', async () => {
    const u = await makeUser();
    const { project } = (await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('members') } })).json();
    const bad = await app.inject({ method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u), payload: { sessionCookie: { name: 'a b', value: 'x' } } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('[SC-3] accounts, plans and billing', () => {
  it('signs up into a free plan, enforces monthly limits and reports usage', async () => {
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { name: 'Sara', email: 'sara@agency.test', password: 'long-password-1', workspace: 'Agency' } });
    expect(signup.statusCode).toBe(201);
    const token = signup.json().token;
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'POST', url: '/auth/signup', payload: { name: 'S', email: 'sara@agency.test', password: 'long-password-1' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/auth/signup', payload: { name: 'S', email: 'x@y.test', password: 'short' } })).statusCode).toBe(400);
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'POST', url: '/projects', headers: h, payload: { url: fx.url('basic') } })).statusCode).toBe(201);
    const over = await app.inject({ method: 'POST', url: '/projects', headers: h, payload: { url: fx.url('basic') } });
    expect(over.statusCode).toBe(402);
    expect(over.json().error).toBe('plan_limit');
    const billing = (await app.inject({ url: '/billing', headers: h })).json();
    expect(billing).toMatchObject({ plan: 'free', usage: { projects: 3 }, limits: { projectsPerMonth: 3, pagesPerMonth: 30 } });
  });

  it('applies signed, idempotent billing webhooks', async () => {
    process.env.BILLING_WEBHOOK_SECRET = 'whsec_test';
    try {
      const u = await makeUser();
      await query("UPDATE workspaces SET plan = 'free' WHERE id = $1", [u.workspace_id]);
      const body = JSON.stringify({ id: 'evt_1', type: 'subscription.updated', workspace_id: u.workspace_id, plan: 'pro' });
      const send = (b: string, sig = signWebhook(b, 'whsec_test')) => app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'content-type': 'application/json', 'x-billing-signature': sig }, payload: b });
      expect((await send(body, 'bad')).statusCode).toBe(401);
      expect((await send(body)).json()).toEqual({ ok: true, duplicate: false });
      expect((await one('SELECT plan FROM workspaces WHERE id = $1', [u.workspace_id])).plan).toBe('pro');
      expect((await send(body)).json()).toEqual({ ok: true, duplicate: true });
      const cancel = JSON.stringify({ id: 'evt_2', type: 'subscription.cancelled', workspace_id: u.workspace_id });
      await send(cancel);
      expect((await one('SELECT plan FROM workspaces WHERE id = $1', [u.workspace_id])).plan).toBe('free');
      expect((await query('SELECT count(*)::int AS n FROM billing_events'))[0].n).toBe(2);
    } finally {
      delete process.env.BILLING_WEBHOOK_SECRET;
    }
  });
});

describe('[SC-4] scaling by queue length', () => {
  it('recommends workers from the backlog, within bounds', () => {
    expect(desiredWorkers({ waiting: 0, active: 0, delayed: 0 }, 3)).toBe(1);
    expect(desiredWorkers({ waiting: 10, active: 3, delayed: 0 }, 3)).toBe(5);
    expect(desiredWorkers({ waiting: 500, active: 3, delayed: 0 }, 3)).toBe(10);
  });

  it('exposes the advice to admins only', async () => {
    const admin = await makeUser('admin');
    const member = await makeUser('member', admin.workspace_id);
    expect((await app.inject({ url: '/admin/metrics/queues', headers: auth(member) })).statusCode).toBe(403);
    const res = (await app.inject({ url: '/admin/metrics/queues', headers: auth(admin) })).json();
    expect(res.capture).toMatchObject({ waiting: expect.any(Number), desired: expect.any(Number) });
  });

  it('[P] ten concurrent projects finish, and a second worker raises throughput', async () => {
    const run = async (workers: number) => {
      await resetDb();
      await resetRedis();
      const extra = Array.from({ length: workers - 1 }, () => startWorker('capture', handlers.capture, { concurrency: 3 }));
      const u = await makeUser();
      const started = Date.now();
      const projects = [];
      for (let i = 0; i < 10; i++) {
        const [p] = await query("INSERT INTO projects(workspace_id, owner_id, root_url, viewports) VALUES ($1,$2,$3,'{\"mobile\":{\"width\":360,\"height\":640,\"scale\":1}}') RETURNING *", [u.workspace_id, u.id, fx.url('slowpages')]);
        await query('INSERT INTO pages(project_id, url, title, selected) VALUES ($1,$2,$3,true),($1,$4,$5,true)', [p.id, fx.url('slowpages', `/a${i}`), 'A', fx.url('slowpages', `/b${i}`), 'B']);
        projects.push(p);
      }
      await Promise.all(projects.map((p) => app.inject({ method: 'POST', url: `/projects/${p.id}/captures`, headers: auth(u), payload: { devices: ['mobile'] } })));
      await waitFor(async () => (await query("SELECT count(*)::int AS n FROM captures WHERE status = 'done'"))[0].n === 20, 170_000, 200);
      for (const w of extra) await w.close();
      return Date.now() - started;
    };
    const one = await run(1);
    const two = await run(2);
    console.log(`10 projects x 2 pages: 1 worker ${one} ms, 2 workers ${two} ms`);
    expect(one).toBeLessThan(180_000);
    expect(two).toBeLessThan(one * 0.85);
  }, 400_000);
});
