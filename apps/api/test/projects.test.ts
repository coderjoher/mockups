import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues } from '@mockups/core/queue';
import { startFixtures } from '../../../tests/setup/fixtures';
import { auth, makeUser, resetDb, resetRedis } from '../../../tests/setup/helpers';

let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
  app = await buildApp();
});
beforeEach(async () => {
  await resetDb();
  await resetRedis();
});
afterAll(async () => {
  fx.server.close();
  await app.close();
  await closeQueues();
  await closePool();
});

describe('[PD-1] create a project from a URL', () => {
  it('normalises the URL, confirms it loads and pre-selects Home', async () => {
    const u = await makeUser();
    const res = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('arabic', '/?utm_source=x') } });
    expect(res.statusCode).toBe(201);
    const { project } = res.json();
    expect(project.root_url).toBe(fx.url('arabic', '/'));
    expect(project.title).toBe('شركة النماذج & التصميم');
    expect(project.language).toBe('ar');
    const pages = await query('SELECT url, selected, favicon_url FROM pages WHERE project_id = $1', [project.id]);
    expect(pages).toEqual([{ url: fx.url('arabic', '/'), selected: true, favicon_url: fx.url('arabic', '/static/icon.png') }]);
    expect((await app.inject({ url: `/projects/${project.id}`, headers: auth(u) })).statusCode).toBe(200);
    expect((await app.inject({ url: '/projects', headers: auth(u) })).json().projects).toHaveLength(1);
  });

  it('explains why a site did not load', async () => {
    const u = await makeUser();
    const down = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('broken') } });
    expect(down.statusCode).toBe(422);
    expect(down.json()).toMatchObject({ error: 'unreachable', message: 'The site did not load (HTTP 500)' });
    const json = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('broken', '/json') } });
    expect(json.json().error).toBe('not_html');
    const bad = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: 'javascript:alert(1)' } });
    expect(bad.statusCode).toBe(422);
  });

  it('[NF-SSRF] refuses internal targets, including through redirects', async () => {
    const u = await makeUser();
    for (const url of ['http://127.0.0.1:4000/health', 'http://169.254.169.254/', fx.url('redirects', '/to-metadata')]) {
      const res = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url } });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe('blocked_url');
    }
  });

  it('keeps projects inside their workspace', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { project } = (await app.inject({ method: 'POST', url: '/projects', headers: auth(a), payload: { url: fx.url('basic') } })).json();
    expect((await app.inject({ url: `/projects/${project.id}`, headers: auth(b) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${project.id}`, headers: auth(b) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/projects/${project.id}`, headers: auth(a), payload: { saved: true } })).json().project.saved).toBe(true);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${project.id}`, headers: auth(a) })).statusCode).toBe(200);
  });
});

describe('[NF-RATE] rate limit over HTTP', () => {
  it('returns 429 with Retry-After once the hourly limit is used, and logs domains', async () => {
    process.env.RATE_LIMIT_PAGES_PER_HOUR = '3';
    try {
      const u = await makeUser();
      const other = await makeUser();
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('basic') } })).statusCode).toBe(201);
      const limited = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url('basic') } });
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect((await app.inject({ method: 'POST', url: '/projects', headers: auth(other), payload: { url: fx.url('basic') } })).statusCode).toBe(201);
      const logged = await query("SELECT count(*)::int AS n FROM domain_log WHERE domain = 'basic.fixture.test'");
      expect(logged[0].n).toBe(4);
    } finally {
      delete process.env.RATE_LIMIT_PAGES_PER_HOUR;
    }
  });
});
