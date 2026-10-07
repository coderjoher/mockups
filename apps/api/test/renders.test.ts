import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues } from '@mockups/core/queue';
import { defaultAssignments } from '@mockups/core/renders';
import { auth, makeUser, resetDb, resetRedis } from '../../../tests/setup/helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
beforeEach(async () => {
  await resetDb();
  await resetRedis();
});
afterAll(async () => {
  await app.close();
  await closeQueues();
  await closePool();
});

const quad = (x: number, y: number, w: number, h: number) => ({ tl: [x, y], tr: [x + w, y], br: [x + w, y + h], bl: [x, y + h] }) as any;

describe('[R-1] each screen gets the capture for its device', () => {
  const caps = [
    { id: 'home-d', page_id: 'home', device: 'desktop', mode: 'fold', page_order: 0, height: 1800 },
    { id: 'home-m', page_id: 'home', device: 'mobile', mode: 'fold', page_order: 0, height: 2532 },
    { id: 'home-mf', page_id: 'home', device: 'mobile', mode: 'full', page_order: 0, height: 9000 },
    { id: 'contact-m', page_id: 'contact', device: 'mobile', mode: 'fold', page_order: 1, height: 2532 },
    { id: 'contact-d', page_id: 'contact', device: 'desktop', mode: 'fold', page_order: 1, height: 1800 },
  ] as any[];

  it('mobile screen -> mobile capture, preferring above-the-fold', () => {
    const a = defaultAssignments([{ screen_key: 's1', device: 'mobile', corners: quad(0, 0, 100, 200), z_index: 1 }], caps);
    expect(a).toEqual({ s1: { captureId: 'home-m', scrollOffset: 0 } });
  });

  it('[CR-2] largest screen shows Home, the next screen the next page', () => {
    const screens = [
      { screen_key: 'phone', device: 'mobile', corners: quad(0, 0, 100, 200), z_index: 2 },
      { screen_key: 'laptop', device: 'desktop', corners: quad(0, 0, 1000, 600), z_index: 1 },
    ] as any[];
    expect(defaultAssignments(screens, caps)).toEqual({ laptop: { captureId: 'home-d', scrollOffset: 0 }, phone: { captureId: 'contact-m', scrollOffset: 0 } });
  });

  it('falls back to the nearest device when a page lacks one', () => {
    const only = caps.filter((c) => c.device === 'mobile');
    const a = defaultAssignments([{ screen_key: 's1', device: 'desktop', corners: quad(0, 0, 100, 60), z_index: 1 }], only);
    expect(a.s1.captureId).toBe('home-m');
  });
});

async function fixture() {
  const admin = await makeUser('admin');
  const [project] = await query('INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,$3) RETURNING *', [admin.workspace_id, admin.id, 'https://example.com/']);
  const [home] = await query("INSERT INTO pages(project_id, url, title, \"order\", selected) VALUES ($1,'https://example.com/','Home',0,true) RETURNING *", [project.id]);
  const [contact] = await query("INSERT INTO pages(project_id, url, title, \"order\", selected) VALUES ($1,'https://example.com/contact','Contact',1,true) RETURNING *", [project.id]);
  const cap = async (page: any, device: string) =>
    (await query("INSERT INTO captures(page_id, device, mode, status, image_key, width, height) VALUES ($1,$2,'fold','done',$3,100,100) RETURNING *", [page.id, device, `c/${page.id}/${device}.png`]))[0];
  const caps = { homeD: await cap(home, 'desktop'), homeM: await cap(home, 'mobile'), contactM: await cap(contact, 'mobile'), contactD: await cap(contact, 'desktop') };
  const [mockup] = await query("INSERT INTO mockups(title, photo_key, width, height, status, licence_source, licence_type) VALUES ('Duo','p.jpg',4000,3000,'published','x','y') RETURNING *");
  await query("INSERT INTO screens(mockup_id, screen_key, device, corners, z_index) VALUES ($1,'laptop','desktop',$2,1),($1,'phone','mobile',$3,2)", [mockup.id, JSON.stringify(quad(100, 100, 2000, 1200)), JSON.stringify(quad(2500, 800, 500, 1000))]);
  return { admin, project, caps, mockup };
}

describe('[CR-2] renders API', () => {
  it('fills defaults, lets the user override a screen, and queues a render job', async () => {
    const { admin, project, caps, mockup } = await fixture();
    const defaults = (await app.inject({ url: `/projects/${project.id}/assignments?mockupId=${mockup.id}`, headers: auth(admin) })).json().assignments;
    expect(defaults).toEqual({ laptop: { captureId: caps.homeD.id, scrollOffset: 0 }, phone: { captureId: caps.contactM.id, scrollOffset: 0 } });

    const res = await app.inject({
      method: 'POST', url: `/projects/${project.id}/renders`, headers: auth(admin),
      payload: { mockupId: mockup.id, preview: true, assignments: { phone: { captureId: caps.homeM.id, scrollOffset: 120.7 } } },
    });
    expect(res.statusCode).toBe(202);
    const render = res.json().render;
    expect(render.assignments).toEqual({ laptop: { captureId: caps.homeD.id, scrollOffset: 0 }, phone: { captureId: caps.homeM.id, scrollOffset: 121 } });
    expect(render.options).toMatchObject({ preview: true });
    const [job] = await query("SELECT payload FROM jobs WHERE type = 'render'");
    expect(job.payload).toEqual({ kind: 'render', renderId: render.id });
    const got = (await app.inject({ url: `/renders/${render.id}`, headers: auth(admin) })).json().render;
    expect(got.status).toBe('queued');
    expect((await app.inject({ url: `/projects/${project.id}/renders`, headers: auth(admin) })).json().renders).toHaveLength(1);
  });

  it('rejects captures from other projects, unknown screens and unpublished mockups', async () => {
    const { admin, project, mockup } = await fixture();
    const other = await fixture();
    const post = (payload: any) => app.inject({ method: 'POST', url: `/projects/${project.id}/renders`, headers: auth(admin), payload });
    expect((await post({ mockupId: mockup.id, assignments: { phone: { captureId: other.caps.homeM.id } } })).statusCode).toBe(422);
    expect((await post({ mockupId: mockup.id, assignments: { tv: { captureId: other.caps.homeM.id } } })).json().message).toBe('Unknown screen tv');
    await query("UPDATE mockups SET status = 'draft' WHERE id = $1", [mockup.id]);
    expect((await post({ mockupId: mockup.id })).statusCode).toBe(404);
    expect((await post({ mockupId: 'nope' })).statusCode).toBe(400);
    const stranger = await makeUser();
    expect((await app.inject({ url: `/renders/${other.mockup.id}`, headers: auth(stranger) })).statusCode).toBe(404);
  });
});
