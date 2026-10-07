import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../apps/api/src/app';
import { closePool, one, query } from '@mockups/core/db';
import { closeQueues } from '@mockups/core/queue';
import { getStorage } from '@mockups/core/storage';
import { detectLanguage, templateGroups } from '@mockups/core/grouping';
import { discoverProject } from '../src/discover';
import { capturePage } from '../src/capture';
import { closeBrowser } from '../src/browser';
import { startFixtures } from '../../../tests/setup/fixtures';
import { auth, makeUser, resetDb, resetRedis } from '../../../tests/setup/helpers';
import { colourShare, decode } from '../../../tests/setup/png';

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
  await closeBrowser();
  fx.server.close();
  await app.close();
  await closeQueues();
  await closePool();
});

const quad = (x: number, y: number, w: number, h: number) => ({ tl: [x, y], tr: [x + w, y], br: [x + w, y + h], bl: [x, y + h] });

async function projectWithCaptures(n: number) {
  const u = await makeUser('admin');
  const [project] = await query("INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,'https://acme.test/') RETURNING *", [u.workspace_id, u.id]);
  const pages = [];
  for (let i = 0; i < n; i++) {
    const [pg] = await query('INSERT INTO pages(project_id, url, title, "order", selected) VALUES ($1,$2,$3,$4,true) RETURNING *', [project.id, `https://acme.test/p${i}`, `Page ${i}`, i]);
    const caps: Record<string, any> = {};
    for (const d of ['desktop', 'mobile']) caps[d] = (await query("INSERT INTO captures(page_id, device, mode, status, image_key, height) VALUES ($1,$2,'fold','done','x.png',1800) RETURNING *", [pg.id, d]))[0];
    pages.push({ pg, caps });
  }
  const [m] = await query("INSERT INTO mockups(title, photo_key, width, height, status, licence_source, licence_type) VALUES ('Duo','p.jpg',4000,3000,'published','x','y') RETURNING *");
  await query("INSERT INTO screens(mockup_id, screen_key, device, corners, z_index) VALUES ($1,'laptop','desktop',$2,1),($1,'phone','mobile',$3,2)", [m.id, JSON.stringify(quad(0, 0, 2000, 1200)), JSON.stringify(quad(2500, 0, 500, 1000))]);
  return { u, project, pages, m };
}

describe('[CR-4] batch mode', () => {
  it('renders one mockup for every captured page, each screen showing that page', async () => {
    const { u, project, pages, m } = await projectWithCaptures(5);
    const res = await app.inject({ method: 'POST', url: `/projects/${project.id}/batch`, headers: auth(u), payload: { mockupId: m.id } });
    expect(res.statusCode).toBe(202);
    const renders = res.json().renders;
    expect(renders).toHaveLength(5);
    renders.forEach((r: any, i: number) => {
      expect(r.assignments).toEqual({ laptop: { captureId: pages[i].caps.desktop.id, scrollOffset: 0 }, phone: { captureId: pages[i].caps.mobile.id, scrollOffset: 0 } });
      expect(r.options).toMatchObject({ batch: true, preview: false });
    });
    expect((await query("SELECT count(*)::int AS n FROM jobs WHERE type = 'render'"))[0].n).toBe(5);
  });
});

describe('[CR-3] scroll offset per screen', () => {
  it('is stored per screen on the render', async () => {
    const { u, project, pages, m } = await projectWithCaptures(1);
    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/renders`, headers: auth(u),
      payload: { mockupId: m.id, assignments: { laptop: { captureId: pages[0].caps.desktop.id, scrollOffset: 800 } } },
    });
    expect(res.json().render.assignments.laptop.scrollOffset).toBe(800);
    expect(res.json().render.assignments.phone.scrollOffset).toBe(0);
  });
});

describe('[CR-5] photo-free layouts', () => {
  it('queues grid and tall-frame renders and validates their style', async () => {
    const { u, project, pages } = await projectWithCaptures(3);
    const ids = pages.map((p) => p.caps.desktop.id);
    const grid = await app.inject({ method: 'POST', url: `/projects/${project.id}/layouts`, headers: auth(u), payload: { layout: 'grid', captureIds: ids, bg: { type: 'gradient', from: '#eef2ff', to: '#c7d2fe' } } });
    expect(grid.statusCode).toBe(202);
    expect(grid.json().render).toMatchObject({ layout: 'grid', mockup_id: null, assignments: { pages: ids.map((captureId) => ({ captureId })) } });
    expect(grid.json().render.options.bg).toEqual({ type: 'gradient', from: '#eef2ff', to: '#c7d2fe', angle: 135 });
    const tall = await app.inject({ method: 'POST', url: `/projects/${project.id}/layouts`, headers: auth(u), payload: { layout: 'tall', captureIds: [ids[0]] } });
    expect(tall.statusCode).toBe(202);
    const bad = [
      { layout: 'tall', captureIds: ids },
      { layout: 'mosaic', captureIds: ids },
      { layout: 'grid', captureIds: [] },
      { layout: 'grid', captureIds: ids, bg: { type: 'solid', colour: 'red' } },
      { layout: 'grid', captureIds: ids, shadow: 3 },
    ];
    for (const payload of bad) expect((await app.inject({ method: 'POST', url: `/projects/${project.id}/layouts`, headers: auth(u), payload })).statusCode).toBe(422);
  });
});

describe('[CP-5] [CP-6] overlay and light map', () => {
  it('attaches uploaded overlay and light map images to a mockup', async () => {
    const { u, m } = await projectWithCaptures(1);
    await getStorage().put(`mockups/${m.id}/overlay-1.png`, Buffer.from('x'));
    await getStorage().put(`mockups/${m.id}/lightmap-1.jpg`, Buffer.from('x'));
    const ok = await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(u), payload: { overlay_key: `mockups/${m.id}/overlay-1.png`, light_map_key: `mockups/${m.id}/lightmap-1.jpg` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mockup.overlay_url).toMatch(/overlay-1\.png/);
    expect(ok.json().mockup.light_map_url).toMatch(/lightmap-1\.jpg/);
    const foreign = await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(u), payload: { overlay_key: 'mockups/other/overlay-1.png' } });
    expect(foreign.statusCode).toBe(422);
    const cleared = await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(u), payload: { overlay_key: null } });
    expect(cleared.json().mockup.overlay_url).toBeNull();
  });
});

describe('[PD-6] template groups', () => {
  it('groups three or more sibling pages under one template', () => {
    const urls = ['/', '/about', '/product/a', '/product/b', '/product/c', '/blog/x', '/blog/y', '/docs/a/b'].map((p) => `https://s.com${p}`);
    const g = templateGroups(urls);
    expect(g.get('https://s.com/product/b')).toBe('/product/*');
    expect(g.has('https://s.com/blog/x')).toBe(false);
    expect(g.has('https://s.com/about')).toBe(false);
  });

  it('stores groups and languages during discovery', async () => {
    const u = await makeUser();
    const [project] = await query('INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,$3) RETURNING *', [u.workspace_id, u.id, fx.url('shop')]);
    await discoverProject({ projectId: project.id });
    const rows = await query('SELECT url, template_group, lang FROM pages WHERE project_id = $1', [project.id]);
    const byPath = Object.fromEntries(rows.map((r) => [new URL(r.url).pathname, r]));
    expect(rows.filter((r) => r.template_group === '/product/*')).toHaveLength(12);
    expect(rows.filter((r) => r.template_group === '/blog/*')).toHaveLength(3);
    expect(byPath['/about'].template_group).toBeNull();
    expect(byPath['/ar/'].lang).toBe('ar');
    expect(byPath['/en/'].lang).toBe('en');
  });
});

describe('[PD-8] language variants', () => {
  it('detects languages from the path, hreflang or <html lang>', () => {
    const alts = [{ href: 'https://s.com/', hreflang: 'x-default' }, { href: 'https://s.com/عربي', hreflang: 'ar-IQ' }];
    expect(detectLanguage('https://s.com/ar/about')).toBe('ar');
    expect(detectLanguage('https://s.com/en-gb/')).toBe('en');
    expect(detectLanguage('https://s.com/عربي', alts)).toBe('ar');
    expect(detectLanguage('https://s.com/x', [], 'EN-us')).toBe('en');
    expect(detectLanguage('https://s.com/arabic')).toBeNull();
  });

  it('filters the checklist by language', async () => {
    const u = await makeUser();
    const [project] = await query('INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,$3) RETURNING *', [u.workspace_id, u.id, fx.url('shop')]);
    await discoverProject({ projectId: project.id });
    const ar = (await app.inject({ url: `/projects/${project.id}/pages?lang=ar`, headers: auth(u) })).json().pages;
    expect(ar.map((p: any) => new URL(p.url).pathname)).toEqual(['/ar/']);
  });
});

describe('[CE-6] sticky headers in full-page mode', () => {
  it('shows the fixed header once at the top and drops floating bottom bars', async () => {
    const res = await capturePage(fx.url('sticky'), 'desktop', { width: 800, height: 600, scale: 1 }, { mode: 'full' });
    const png = decode(res.png);
    const orange = (y: number) => colourShare(png, [255, 102, 0], 8, { x: 0, y, w: 800, h: 1 }) > 0.9;
    const rows = Array.from({ length: png.height }, (_, y) => orange(y));
    expect(rows.slice(0, 80).every(Boolean)).toBe(true);
    expect(rows.slice(80).some(Boolean)).toBe(false);
    expect(colourShare(png, [0, 170, 0], 8)).toBe(0);
  });
});

describe('[CE-7] dark mode, hidden elements and extra delay', () => {
  const vp = { width: 600, height: 500, scale: 1 };
  it('captures the dark colour scheme', async () => {
    const light = decode((await capturePage(fx.url('darkmode'), 'desktop', vp)).png);
    const dark = decode((await capturePage(fx.url('darkmode'), 'desktop', vp, { dark: true })).png);
    expect(colourShare(light, [255, 255, 255], 2, { x: 0, y: 450, w: 600, h: 40 })).toBeGreaterThan(0.95);
    expect(colourShare(dark, [17, 17, 17], 2, { x: 0, y: 450, w: 600, h: 40 })).toBeGreaterThan(0.95);
  });

  it('hides elements by CSS selector and waits the extra delay', async () => {
    const plain = decode((await capturePage(fx.url('darkmode'), 'desktop', vp)).png);
    expect(colourShare(plain, [255, 0, 255], 2)).toBeGreaterThan(0.1);
    expect(colourShare(plain, [0, 255, 255], 2)).toBe(0);
    const tuned = decode((await capturePage(fx.url('darkmode'), 'desktop', vp, { hideSelectors: ['.promo'], delayMs: 6000 })).png);
    expect(colourShare(tuned, [255, 0, 255], 2)).toBe(0);
    expect(colourShare(tuned, [0, 255, 255], 2)).toBeGreaterThan(0.1);
  });
});
