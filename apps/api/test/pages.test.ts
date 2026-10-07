import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildApp } from '../src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues, startWorker } from '@mockups/core/queue';
import { upsertPages } from '@mockups/core/pages';
import { handlers } from '../../../workers/capture/src/handlers';
import { startFixtures } from '../../../tests/setup/fixtures';
import { auth, makeUser, resetDb, resetRedis, waitFor } from '../../../tests/setup/helpers';

let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof startFixtures>>;
let worker: Worker;
beforeAll(async () => {
  fx = await startFixtures();
  app = await buildApp();
  worker = startWorker('discover', handlers.discover);
});
beforeEach(async () => {
  await resetDb();
  await resetRedis();
});
afterAll(async () => {
  await worker.close();
  fx.server.close();
  await app.close();
  await closeQueues();
  await closePool();
});

async function newProject(site: string) {
  const u = await makeUser();
  const res = await app.inject({ method: 'POST', url: '/projects', headers: auth(u), payload: { url: fx.url(site) } });
  return { u, project: res.json().project, jobId: res.json().discoveryJobId };
}

describe('[PD-5] checklist API', () => {
  it('runs discovery automatically after the project is created', async () => {
    const { u, project, jobId } = await newProject('nositemap');
    expect(jobId).toBeTruthy();
    const pages = await waitFor(async () => {
      const r = (await app.inject({ url: `/projects/${project.id}/pages`, headers: auth(u) })).json();
      return r.discovery.status === 'done' && r.pages;
    });
    expect(pages.map((p: any) => p.title)).toEqual(['No-sitemap home', 'About', 'Services', 'Contact', 'Blog', 'Team', 'First post']);
    expect(pages[0].selected).toBe(true);
    expect(pages.slice(1).every((p: any) => !p.selected)).toBe(true);
    // Re-running discovery does not duplicate pages.
    await app.inject({ method: 'POST', url: `/projects/${project.id}/discover`, headers: auth(u) });
    await waitFor(async () => (await app.inject({ url: `/projects/${project.id}/pages`, headers: auth(u) })).json().discovery.status === 'done');
    expect((await query('SELECT count(*)::int AS n FROM pages WHERE project_id = $1', [project.id]))[0].n).toBe(7);
  });
});

describe('[PD-7] manual pages and search', () => {
  it('adds a page by path or full URL through normalisation and the SSRF guard', async () => {
    const { u, project } = await newProject('sitemap');
    const rel = await app.inject({ method: 'POST', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { url: '/pricing?utm_source=x' } });
    expect(rel.statusCode).toBe(201);
    expect(rel.json().page).toMatchObject({ url: fx.url('sitemap', '/pricing'), title: 'Pricing', source: 'manual' });
    const abs = await app.inject({ method: 'POST', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { url: fx.url('nositemap', '/about') } });
    expect(abs.json().page.title).toBe('About');
    const blocked = await app.inject({ method: 'POST', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { url: 'http://10.0.0.1/admin' } });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toBe('blocked_url');
    const missing = await app.inject({ method: 'POST', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { url: '/does-not-exist' } });
    expect(missing.json().error).toBe('unreachable');
  });

  it('filters the list by title or URL', async () => {
    const { u, project } = await newProject('sitemap');
    await upsertPages(project.id, [
      { url: fx.url('sitemap', '/about'), title: 'About us' },
      { url: fx.url('sitemap', '/contact'), title: 'Get in touch' },
    ]);
    const byTitle = (await app.inject({ url: `/projects/${project.id}/pages?q=TOUCH`, headers: auth(u) })).json().pages;
    expect(byTitle.map((p: any) => p.title)).toEqual(['Get in touch']);
    const byUrl = (await app.inject({ url: `/projects/${project.id}/pages?q=about`, headers: auth(u) })).json().pages;
    expect(byUrl.map((p: any) => p.title)).toEqual(['About us']);
  });
});

describe('[PD-9] at most 20 selected pages', () => {
  it('refuses a 21st selection and leaves the selection unchanged', async () => {
    const { u, project } = await newProject('basic');
    await upsertPages(project.id, Array.from({ length: 25 }, (_, i) => ({ url: fx.url('basic', `/p${i}`), title: `P${i}` })));
    const ids = (await query('SELECT id FROM pages WHERE project_id = $1 AND NOT selected ORDER BY "order"', [project.id])).map((r) => r.id);
    const ok = await app.inject({ method: 'PATCH', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { pageIds: ids.slice(0, 19), selected: true } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pages.filter((p: any) => p.selected)).toHaveLength(20);
    const over = await app.inject({ method: 'PATCH', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { pageIds: [ids[19]], selected: true } });
    expect(over.statusCode).toBe(422);
    expect(over.json()).toMatchObject({ error: 'selection_limit', message: 'You can select up to 20 pages per project' });
    const off = await app.inject({ method: 'PATCH', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { pageIds: [ids[0]], selected: false } });
    expect(off.json().pages.filter((p: any) => p.selected)).toHaveLength(19);
    const bad = await app.inject({ method: 'PATCH', url: `/projects/${project.id}/pages`, headers: auth(u), payload: { pageIds: ['x'] } });
    expect(bad.statusCode).toBe(400);
  });
});
