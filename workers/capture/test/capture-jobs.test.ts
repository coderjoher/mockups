import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { buildApp } from '../../../apps/api/src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues, startWorker } from '@mockups/core/queue';
import { upsertPages } from '@mockups/core/pages';
import { handlers } from '../src/handlers';
import { closeBrowser } from '../src/browser';
import { startFixtures } from '../../../tests/setup/fixtures';
import { auth, makeUser, resetDb, resetRedis, waitFor } from '../../../tests/setup/helpers';
import { decode } from '../../../tests/setup/png';
import { slowStats } from '../../../tests/fixtures/dynamic';

let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof startFixtures>>;
let worker: Worker;
beforeAll(async () => {
  fx = await startFixtures();
  app = await buildApp();
  // Six slots in the worker: the per-project limit of 3 must come from the scheduler, not the worker.
  worker = startWorker('capture', handlers.capture, { concurrency: 6 });
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

async function projectWith(site: string, paths: string[]) {
  const u = await makeUser();
  const [project] = await query('INSERT INTO projects(workspace_id, owner_id, root_url, viewports) VALUES ($1,$2,$3,$4) RETURNING *', [
    u.workspace_id, u.id, fx.url(site), JSON.stringify({ desktop: { width: 800, height: 600, scale: 1 }, tablet: { width: 600, height: 800, scale: 1 }, mobile: { width: 360, height: 640, scale: 1 } }),
  ]);
  await upsertPages(project.id, paths.map((p) => ({ url: fx.url(site, p), title: p, selected: true })));
  return { u, project };
}

const allDone = (app: FastifyInstance, u: any, id: string, n: number) =>
  waitFor(async () => {
    const caps = (await app.inject({ url: `/projects/${id}/captures`, headers: auth(u) })).json().captures;
    return caps.length === n && caps.every((c: any) => c.status === 'done' || c.status === 'failed') && caps;
  }, 120_000, 200);

describe('[CE-10] three pages at a time per project', () => {
  it('never runs more than 3 page jobs at once, queues the rest and reports per-page progress', async () => {
    slowStats.max = 0;
    const { u, project } = await projectWith('slowpages', ['/1', '/2', '/3', '/4', '/5', '/6']);
    const res = await app.inject({ method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u), payload: { devices: ['desktop'] } });
    expect(res.statusCode).toBe(202);
    const first = res.json().captures;
    expect(first).toHaveLength(6);
    expect(first.every((c: any) => ['queued', 'running'].includes(c.status))).toBe(true);
    expect((await query("SELECT count(*)::int AS n FROM jobs WHERE type = 'capture'"))[0].n).toBe(3); // the rest wait

    const statuses = new Set<string>();
    const caps = await waitFor(async () => {
      const c = (await app.inject({ url: `/projects/${project.id}/captures`, headers: auth(u) })).json().captures;
      c.forEach((x: any) => statuses.add(x.status));
      return c.every((x: any) => x.status === 'done') && c;
    }, 120_000, 100);
    expect(statuses).toContain('running');
    expect(caps.every((c: any) => c.image_url)).toBe(true);

    // One job per page, and the site never saw more than three of its pages loading at once.
    // The job row is marked done just after its last capture, so wait for it.
    const jobs = await waitFor(async () => {
      const rows = await query("SELECT status FROM jobs WHERE type = 'capture'");
      return rows.every((j) => j.status === 'done') && rows;
    });
    expect(jobs).toHaveLength(6);
    expect(slowStats.max).toBeLessThanOrEqual(3);
    expect(slowStats.max).toBeGreaterThan(1);
  });
});

describe('[CE-9] a failing page never blocks the rest', () => {
  it('stores the reason on the failed capture and finishes the others', async () => {
    process.env.CAPTURE_TIMEOUT_MS = '2000';
    try {
      const { u, project } = await projectWith('capture', ['/']);
      await upsertPages(project.id, [{ url: fx.url('missing', '/gone'), title: 'Gone', selected: true }]);
      await app.inject({ method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u), payload: { devices: ['mobile'] } });
      const caps = await allDone(app, u, project.id, 2);
      const failed = caps.find((c: any) => c.status === 'failed');
      expect(failed.error).toBe('The page returned HTTP 404');
      expect(caps.find((c: any) => c.status === 'done').url).toBe(fx.url('capture'));
      // Retried once before giving up.
      const [job] = await query('SELECT attempts, status FROM jobs WHERE id = $1', [failed.job_id]);
      expect(job).toMatchObject({ attempts: 2, status: 'done' });
    } finally {
      delete process.env.CAPTURE_TIMEOUT_MS;
    }
  });
});

describe('[CE-1] captures through the API use project viewports', () => {
  it('stores PNGs at the project viewport size for each device, and rejects bad input', async () => {
    const { u, project } = await projectWith('capture', ['/']);
    const vp = await app.inject({ method: 'PUT', url: `/projects/${project.id}/viewports`, headers: auth(u), payload: { desktop: { width: 1024, height: 640, scale: 1 } } });
    expect(vp.json().viewports.desktop).toEqual({ width: 1024, height: 640, scale: 1 });
    expect((await app.inject({ method: 'PUT', url: `/projects/${project.id}/viewports`, headers: auth(u), payload: { tv: {} } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u), payload: { devices: ['watch'] } })).statusCode).toBe(400);
    await app.inject({ method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u), payload: { devices: ['desktop', 'mobile'] } });
    const caps = await allDone(app, u, project.id, 2);
    const desktop = caps.find((c: any) => c.device === 'desktop');
    expect([desktop.width, desktop.height]).toEqual([1024, 640]);
    expect(decode(readFileSync(`${process.env.STORAGE_DIR}/${desktop.image_key}`)).width).toBe(1024);
  });
});

describe('[P] capture performance', () => {
  it('one page at three devices in under 30 s; ten pages in under 3 minutes', async () => {
    const { u, project } = await projectWith('capture', ['/']);
    await query("UPDATE projects SET viewports = '{}' WHERE id = $1", [project.id]);
    let t = Date.now();
    await app.inject({ method: 'POST', url: `/projects/${project.id}/captures`, headers: auth(u), payload: {} });
    const one = await allDone(app, u, project.id, 3);
    console.log(`1 page x 3 devices: ${Date.now() - t} ms`);
    expect(Date.now() - t).toBeLessThan(30_000);
    const mobile = decode(readFileSync(`${process.env.STORAGE_DIR}/${one.find((c: any) => c.device === 'mobile').image_key}`));
    expect([mobile.width, mobile.height]).toEqual([1170, 2532]);

    const ten = await projectWith('capture', Array.from({ length: 10 }, (_, i) => `/?p=${i}`));
    await query("UPDATE projects SET viewports = '{}' WHERE id = $1", [ten.project.id]);
    t = Date.now();
    await app.inject({ method: 'POST', url: `/projects/${ten.project.id}/captures`, headers: auth(ten.u), payload: {} });
    await allDone(app, ten.u, ten.project.id, 30);
    console.log(`10 pages x 3 devices: ${Date.now() - t} ms`);
    expect(Date.now() - t).toBeLessThan(180_000);
  }, 240_000);
});
