import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildApp } from '../../../apps/api/src/app';
import { closePool, one, query } from '@mockups/core/db';
import { closeQueues, startWorker } from '@mockups/core/queue';
import { captureCacheKey } from '@mockups/core/cache';
import { deltaE, pickBrandColours } from '@mockups/core/brand';
import { handlers } from '../src/handlers';
import { closeBrowser } from '../src/browser';
import { startFixtures } from '../../../tests/setup/fixtures';
import { brandStats } from '../../../tests/fixtures/dynamic';
import { auth, makeUser, resetDb, resetRedis, waitFor } from '../../../tests/setup/helpers';

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

async function brandProject() {
  const u = await makeUser();
  const [project] = await query("INSERT INTO projects(workspace_id, owner_id, root_url, viewports, title) VALUES ($1,$2,$3,$4,'Brand Co') RETURNING *", [
    u.workspace_id, u.id, fx.url('brand'), JSON.stringify({ desktop: { width: 1000, height: 700, scale: 1 } }),
  ]);
  await query('INSERT INTO pages(project_id, url, title, "order", selected) VALUES ($1,$2,$3,0,true)', [project.id, fx.url('brand'), 'Brand Co']);
  return { u, project };
}

const capture = async (app: FastifyInstance, u: any, projectId: string, options: Record<string, unknown> = {}) => {
  await app.inject({ method: 'POST', url: `/projects/${projectId}/captures`, headers: auth(u), payload: { devices: ['desktop'], options } });
  return waitFor(async () => {
    const c = (await app.inject({ url: `/projects/${projectId}/captures`, headers: auth(u) })).json().captures;
    return c.length && c.every((x: any) => x.status === 'done') && c;
  }, 60_000, 100);
};

describe('[CX-3] brand colours from CSS and logo', () => {
  it('finds the header, button and logo colours (ΔE < 5) when Home is captured', async () => {
    const { u, project } = await brandProject();
    await capture(app, u, project.id);
    const { brand_colors } = (await one('SELECT brand_colors FROM projects WHERE id = $1', [project.id]))!;
    for (const expected of ['#0f766e', '#e11d48', '#f59e0b']) {
      expect(Math.min(...brand_colors.map((c: string) => deltaE(c, expected)))).toBeLessThan(5);
    }
    expect(brand_colors.every((c: string) => deltaE(c, '#ffffff') > 10 && deltaE(c, '#222222') > 10)).toBe(true);
    const api = (await app.inject({ url: `/projects/${project.id}`, headers: auth(u) })).json().project;
    expect(api.brand_colors).toEqual(brand_colors);
  });

  it('merges near-identical colours and ignores greys', () => {
    expect(pickBrandColours([['#e11d48', 100], ['#e21e49', 90], ['#888888', 500], ['#0f766e', 50]])).toEqual(['#e11d48', '#0f766e']);
  });
});

describe('[CE-12] 24 hour capture cache', () => {
  it('reuses a capture of the same URL, viewport and options; different options miss', async () => {
    const a = await brandProject();
    await capture(app, a.u, a.project.id);
    const loadsAfterFirst = brandStats.pageLoads;
    const b = await brandProject();
    const cached = await capture(app, b.u, b.project.id);
    expect(brandStats.pageLoads).toBe(loadsAfterFirst); // no new browser visit
    expect(cached[0].image_url).toBeTruthy();
    const [first] = await query('SELECT image_key FROM captures c JOIN pages p ON p.id = c.page_id WHERE p.project_id = $1', [a.project.id]);
    const [second] = await query('SELECT image_key FROM captures c JOIN pages p ON p.id = c.page_id WHERE p.project_id = $1', [b.project.id]);
    expect(second.image_key).not.toBe(first.image_key); // its own copy, so retention stays per project
    const c = await brandProject();
    await capture(app, c.u, c.project.id, { dark: true });
    expect(brandStats.pageLoads).toBeGreaterThan(loadsAfterFirst);
    // Older than 24 hours: miss.
    await query("UPDATE captures SET updated_at = now() - interval '25 hours'");
    const before = brandStats.pageLoads;
    const d = await brandProject();
    await capture(app, d.u, d.project.id);
    expect(brandStats.pageLoads).toBeGreaterThan(before);
  });

  it('keys on URL, device, mode, viewport and options, ignoring option order', () => {
    const k = captureCacheKey('https://a/', 'desktop', 'fold', { width: 1, height: 2 }, { dark: true, delayMs: 5 });
    expect(captureCacheKey('https://a/', 'desktop', 'fold', { height: 2, width: 1 }, { delayMs: 5, dark: true })).toBe(k);
    expect(captureCacheKey('https://a/', 'mobile', 'fold', { width: 1, height: 2 }, { dark: true, delayMs: 5 })).not.toBe(k);
  });
});

describe('[EX-4] shareable gallery links', () => {
  it('shows finished renders to anyone with the link, read-only, until revoked', async () => {
    const { u, project } = await brandProject();
    await query("INSERT INTO renders(project_id, layout, status, outputs, options) VALUES ($1,'grid','done','{\"png\":\"renders/x/a.png\"}','{\"preview\":false}')", [project.id]);
    await query("INSERT INTO renders(project_id, layout, status, outputs, options) VALUES ($1,'grid','done','{\"preview\":\"renders/x/p.jpg\"}','{\"preview\":true}')", [project.id]);
    const link = (await app.inject({ method: 'POST', url: `/projects/${project.id}/share`, headers: auth(u) })).json().link;
    expect(link.token).toHaveLength(24);
    const pub = await app.inject({ url: `/share/${link.token}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ title: 'Brand Co' });
    expect(pub.json().renders).toHaveLength(1);
    expect(pub.json().renders[0].urls.png).toMatch(/\/files\/renders\//);
    expect(JSON.stringify(pub.json())).not.toContain(u.email);
    // Read-only: no write routes exist for share tokens, and the token is not a session.
    expect((await app.inject({ method: 'POST', url: `/share/${link.token}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/projects/${project.id}`, headers: { authorization: `Bearer ${link.token}` } })).statusCode).toBe(401);
    // Other workspaces cannot revoke; the owner can.
    const stranger = await makeUser();
    expect((await app.inject({ method: 'DELETE', url: `/share-links/${link.id}`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/share-links/${link.id}`, headers: auth(u) })).statusCode).toBe(200);
    expect((await app.inject({ url: `/share/${link.token}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/projects/${project.id}/share`, headers: auth(u) })).json().links[0].revoked_at).toBeTruthy();
  });
});

describe('[ML-3] favourites and recently used', () => {
  it('lists favourites per user and recently used mockups per workspace', async () => {
    const { u, project } = await brandProject();
    const mk = async (title: string) => (await query("INSERT INTO mockups(title, photo_key, width, height, status, licence_source, licence_type) VALUES ($1,'p.jpg',3000,3000,'published','x','y') RETURNING *", [title]))[0];
    const [a, b, c] = [await mk('A'), await mk('B'), await mk('C')];
    expect((await app.inject({ method: 'PUT', url: `/mockups/${b.id}/favourite`, headers: auth(u) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/mockups/${b.id}/favourite`, headers: auth(u) })).statusCode).toBe(200);
    const favs = (await app.inject({ url: '/mockups?favourites=1', headers: auth(u) })).json().mockups;
    expect(favs.map((m: any) => m.title)).toEqual(['B']);
    expect((await app.inject({ url: '/mockups', headers: auth(u) })).json().mockups.find((m: any) => m.id === b.id).favourite).toBe(true);
    const other = await makeUser();
    expect((await app.inject({ url: '/mockups?favourites=1', headers: auth(other) })).json().mockups).toEqual([]);
    await app.inject({ method: 'DELETE', url: `/mockups/${b.id}/favourite`, headers: auth(u) });
    expect((await app.inject({ url: '/mockups?favourites=1', headers: auth(u) })).json().mockups).toEqual([]);

    await query("INSERT INTO renders(project_id, mockup_id, status, created_at) VALUES ($1,$2,'done', now() - interval '2 hours'),($1,$3,'done', now()),($1,$2,'done', now() - interval '1 hour')", [project.id, a.id, c.id]);
    const recent = (await app.inject({ url: '/mockups/recent', headers: auth(u) })).json().mockups;
    expect(recent.map((m: any) => m.title)).toEqual(['C', 'A']);
  });
});
