import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PNG } from 'pngjs';
import { buildApp } from '../src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues } from '@mockups/core/queue';
import { isConvexClockwise, validateScreen, validateScreens } from '@mockups/core/screens';
import { orientationOf } from '@mockups/core/mockups';
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

// A tiny PNG header is enough for size checks; the body does not need to decode for upload validation.
function photo(w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h, colorType: 0, bitDepth: 8, inputColorType: 0 } as any);
  return PNG.sync.write(p, { colorType: 0 });
}

function form(user: { token: string }, name: string, body: Buffer, type = 'image/png') {
  const boundary = '----m' + Math.random().toString(16).slice(2);
  return {
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { ...auth(user), 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const PRD_EXAMPLE = {
  screenId: 's1',
  device: 'mobile',
  corners: { tl: [1204, 388], tr: [1712, 402], br: [1690, 1466], bl: [1182, 1450] },
  cornerRadius: 38,
  maskUrl: 'masks/iphone-notch.png',
  zIndex: 1,
};
const PHOTO = { width: 3000, height: 2000 };
const SCREEN = { ...PRD_EXAMPLE, maskUrl: null };

describe('[CP-2] screen definitions', () => {
  it('accepts the PRD example', () => {
    expect(validateScreen(PRD_EXAMPLE, PHOTO)).toMatchObject({ screenId: 's1', device: 'mobile', cornerRadius: 38, zIndex: 1 });
  });

  it.each([
    ['missing corner', { ...PRD_EXAMPLE, corners: { tl: [1, 1], tr: [100, 1], br: [100, 100] } }, 'corner bl'],
    ['wrong order (self-intersecting)', { ...PRD_EXAMPLE, corners: { tl: [1204, 388], tr: [1690, 1466], br: [1712, 402], bl: [1182, 1450] } }, 'in order'],
    ['counter-clockwise order', { ...PRD_EXAMPLE, corners: { tl: [1204, 388], tr: [1182, 1450], br: [1690, 1466], bl: [1712, 402] } }, 'in order'],
    ['outside the photo', { ...PRD_EXAMPLE, corners: { ...PRD_EXAMPLE.corners, br: [3500, 1466] } }, 'outside the photo'],
    ['unknown device', { ...PRD_EXAMPLE, device: 'watch' }, 'device must be'],
    ['bad id', { ...PRD_EXAMPLE, screenId: 'a b' }, 'Screen id'],
    ['tiny area', { ...PRD_EXAMPLE, corners: { tl: [0, 0], tr: [5, 0], br: [5, 5], bl: [0, 5] } }, 'too small'],
    ['negative radius', { ...PRD_EXAMPLE, cornerRadius: -1 }, 'corner radius'],
  ])('rejects %s', (_name, screen, msg) => {
    expect(() => validateScreen(screen, PHOTO)).toThrow(msg as string);
  });

  it('rejects duplicate ids and too many screens', () => {
    expect(() => validateScreens([PRD_EXAMPLE, PRD_EXAMPLE], PHOTO)).toThrow('unique');
    expect(() => validateScreens('x', PHOTO)).toThrow('list');
  });

  it('checks convexity and clockwise order', () => {
    expect(isConvexClockwise({ tl: [0, 0], tr: [10, 0], br: [10, 10], bl: [0, 10] })).toBe(true);
    expect(isConvexClockwise({ tl: [0, 0], tr: [0, 10], br: [10, 10], bl: [10, 0] })).toBe(false);
  });
});

async function uploadMockup(admin: any, w = 3200, h = 2000, name = 'desk-scene.png') {
  return app.inject({ method: 'POST', url: '/admin/mockups', ...form(admin, name, photo(w, h)) });
}

describe('[CP-1] photo upload', () => {
  it('needs JPG or PNG at least 3000 px on the long side', async () => {
    const admin = await makeUser('admin');
    const small = await uploadMockup(admin, 2999, 2000);
    expect(small.statusCode).toBe(422);
    expect(small.json().message).toBe('The photo must be at least 3000 px on its long side (this one is 2999 px)');
    const tall = await uploadMockup(admin, 1800, 3000);
    expect(tall.statusCode).toBe(201);
    expect(tall.json().mockup).toMatchObject({ width: 1800, height: 3000, orientation: 'portrait', status: 'draft', title: 'desk scene' });
    const gif = await app.inject({ method: 'POST', url: '/admin/mockups', ...form(admin, 'x.gif', Buffer.from('GIF89a' + 'x'.repeat(20)), 'image/gif') });
    expect(gif.statusCode).toBe(422);
    // A thumbnail job is queued for the render worker.
    expect((await query("SELECT payload FROM jobs WHERE type = 'render'"))[0].payload).toMatchObject({ kind: 'thumbnail' });
  });

  it('is admin only', async () => {
    const member = await makeUser('member');
    expect((await uploadMockup(member)).statusCode).toBe(403);
    expect((await app.inject({ url: '/admin/mockups', headers: auth(member) })).statusCode).toBe(403);
  });

  it('derives orientation', () => {
    expect(orientationOf(4000, 3000)).toBe('landscape');
    expect(orientationOf(3000, 3050)).toBe('square');
    expect(orientationOf(2000, 3000)).toBe('portrait');
  });
});

describe('[CP-4] per-screen device, radius and mask', () => {
  it('stores screens with device, corner radius, mask and z-index, replacing earlier ones', async () => {
    const admin = await makeUser('admin');
    const m = (await uploadMockup(admin)).json().mockup;
    const mask = await app.inject({ method: 'POST', url: `/admin/mockups/${m.id}/assets/mask-s1`, ...form(admin, 'notch.png', photo(100, 200)) });
    expect(mask.statusCode).toBe(200);
    const screens = [
      { ...PRD_EXAMPLE, maskUrl: mask.json().key },
      { screenId: 's2', device: 'desktop', corners: { tl: [100, 100], tr: [1100, 120], br: [1090, 700], bl: [110, 690] }, cornerRadius: 0, zIndex: 0 },
    ];
    const res = await app.inject({ method: 'PUT', url: `/admin/mockups/${m.id}/screens`, headers: auth(admin), payload: { screens } });
    expect(res.statusCode).toBe(200);
    const saved = res.json().mockup.screens;
    expect(saved.map((s: any) => [s.screen_key, s.device, s.corner_radius, s.z_index])).toEqual([['s2', 'desktop', 0, 0], ['s1', 'mobile', 38, 1]]);
    expect(saved[1].corners).toEqual(PRD_EXAMPLE.corners);
    expect(saved[1].mask_url).toMatch(/\/files\/mockups\//);
    // Replace with one screen.
    await app.inject({ method: 'PUT', url: `/admin/mockups/${m.id}/screens`, headers: auth(admin), payload: { screens: [screens[1]] } });
    expect((await query('SELECT count(*)::int AS n FROM screens WHERE mockup_id = $1', [m.id]))[0].n).toBe(1);
    const bad = await app.inject({ method: 'PUT', url: `/admin/mockups/${m.id}/screens`, headers: auth(admin), payload: { screens: [{ ...SCREEN, device: 'tv' }] } });
    expect(bad.statusCode).toBe(422);
    const foreignMask = await app.inject({ method: 'PUT', url: `/admin/mockups/${m.id}/screens`, headers: auth(admin), payload: { screens: [{ ...PRD_EXAMPLE, maskUrl: '../../etc/passwd' }] } });
    expect(foreignMask.statusCode).toBe(422);
  });
});

describe('[CP-7] licence metadata is required to publish', () => {
  it('refuses to publish without licence info, then publishes once it is filled in', async () => {
    const admin = await makeUser('admin');
    const m = (await uploadMockup(admin)).json().mockup;
    let res = await app.inject({ method: 'POST', url: `/admin/mockups/${m.id}/publish`, headers: auth(admin) });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe('Licence source is required. Licence type is required. Mark at least one screen');
    await app.inject({ method: 'PUT', url: `/admin/mockups/${m.id}/screens`, headers: auth(admin), payload: { screens: [SCREEN] } });
    const meta = await app.inject({
      method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(admin),
      payload: { title: 'Phone on desk', tags: 'phone, Desk ,  ', scene: 'desk', device_type: 'mobile', tone: 'light', licence_source: 'https://unsplash.com/photos/abc', licence_type: 'CC BY 4.0', attribution_required: true },
    });
    expect(meta.json().mockup.tags).toEqual(['phone', 'desk']);
    res = await app.inject({ method: 'POST', url: `/admin/mockups/${m.id}/publish`, headers: auth(admin) });
    expect(res.json().message).toBe('Attribution text is required by this licence');
    await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(admin), payload: { attribution: 'Photo by Jane Doe on Unsplash' } });
    res = await app.inject({ method: 'POST', url: `/admin/mockups/${m.id}/publish`, headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().mockup.status).toBe('published');
    // A published mockup cannot lose its licence.
    const strip = await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(admin), payload: { licence_type: '' } });
    expect(strip.statusCode).toBe(422);
    expect((await query('SELECT licence_type FROM mockups WHERE id = $1', [m.id]))[0].licence_type).toBe('CC BY 4.0');
    const badScene = await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(admin), payload: { scene: 'beach' } });
    expect(badScene.statusCode).toBe(422);
  });
});

describe('[CP-8] [ML-1] library shows published mockups with filters', () => {
  it('hides drafts from members and filters by device, scene, tone and orientation', async () => {
    const admin = await makeUser('admin');
    const member = await makeUser('member', admin.workspace_id);
    const make = async (title: string, w: number, h: number, meta: Record<string, string>, publish = true) => {
      const m = (await uploadMockup(admin, w, h, `${title}.png`)).json().mockup;
      await app.inject({ method: 'PUT', url: `/admin/mockups/${m.id}/screens`, headers: auth(admin), payload: { screens: [{ ...SCREEN, corners: { tl: [10, 10], tr: [500, 10], br: [500, 900], bl: [10, 900] } }] } });
      await app.inject({ method: 'PATCH', url: `/admin/mockups/${m.id}`, headers: auth(admin), payload: { ...meta, licence_source: 'in-house', licence_type: 'In-house (owned)' } });
      if (publish) await app.inject({ method: 'POST', url: `/admin/mockups/${m.id}/publish`, headers: auth(admin) });
      return m;
    };
    await make('laptop-desk', 4000, 3000, { device_type: 'laptop', scene: 'desk', tone: 'warm' });
    await make('phone-hand', 2000, 3000, { device_type: 'mobile', scene: 'hand', tone: 'light' });
    await make('phone-studio-dark', 2000, 3000, { device_type: 'mobile', scene: 'studio', tone: 'dark' });
    const draft = await make('secret-draft', 4000, 3000, { device_type: 'laptop', scene: 'desk', tone: 'warm' }, false);

    const titles = async (qs: string, who = member) => (await app.inject({ url: `/mockups${qs}`, headers: auth(who) })).json().mockups.map((m: any) => m.title).sort();
    expect(await titles('')).toEqual(['laptop desk', 'phone hand', 'phone studio dark']);
    expect(await titles('?device=mobile')).toEqual(['phone hand', 'phone studio dark']);
    expect(await titles('?device=mobile&tone=dark')).toEqual(['phone studio dark']);
    expect(await titles('?scene=desk')).toEqual(['laptop desk']);
    expect(await titles('?orientation=portrait')).toEqual(['phone hand', 'phone studio dark']);
    expect(await titles('?orientation=landscape&scene=hand')).toEqual([]);
    expect(await titles('?q=studio')).toEqual(['phone studio dark']);
    expect((await app.inject({ url: `/mockups/${draft.id}`, headers: auth(member) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/mockups/${draft.id}`, headers: auth(admin) })).statusCode).toBe(200);
    const adminList = (await app.inject({ url: '/admin/mockups', headers: auth(admin) })).json().mockups;
    expect(adminList).toHaveLength(4);
  });
});
