import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PNG } from 'pngjs';
import { buildApp } from '../src/app';
import { closePool, query } from '@mockups/core/db';
import { closeQueues } from '@mockups/core/queue';
import { getStorage } from '@mockups/core/storage';
import { inspectImage } from '@mockups/core/images';
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

export function pngBytes(w = 40, h = 30): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(200);
  return PNG.sync.write(png);
}

function multipart(user: { token: string }, name: string, body: Buffer, type = 'image/png') {
  const boundary = '----mockups' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { ...auth(user), 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function setup(status: 'done' | 'failed') {
  const u = await makeUser();
  const [project] = await query('INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,$3) RETURNING *', [u.workspace_id, u.id, 'https://example.com/']);
  const [page] = await query('INSERT INTO pages(project_id, url, title, selected) VALUES ($1,$2,$3,true) RETURNING *', [project.id, 'https://example.com/', 'Home']);
  const caps = [];
  for (const device of ['desktop', 'tablet', 'mobile']) {
    const [c] = await query("INSERT INTO captures(page_id, device, mode, status, error, image_key) VALUES ($1,$2,'fold',$3,$4,$5) RETURNING *", [
      page.id, device, status, status === 'failed' ? 'The page took longer than 45 seconds to load' : null, status === 'done' ? `captures/x/${device}.png` : null,
    ]);
    caps.push(c);
  }
  return { u, project, page, caps };
}

describe('[CE-11] recapture a single cell', () => {
  it('re-queues only that page x device as one new job', async () => {
    const { u, project, caps } = await setup('done');
    const res = await app.inject({ method: 'POST', url: `/captures/${caps[1].id}/recapture`, headers: auth(u) });
    expect(res.statusCode).toBe(200);
    const rows = await query('SELECT device, status, job_id FROM captures ORDER BY device');
    expect(rows.map((r) => `${r.device}:${r.status}`)).toEqual(['desktop:done', 'mobile:done', 'tablet:queued']);
    const jobs = await query("SELECT payload FROM jobs WHERE type = 'capture'");
    expect(jobs).toHaveLength(1);
    expect(rows.find((r) => r.device === 'tablet').job_id).toBeTruthy();
    // Already running -> 409; other workspaces -> 404.
    expect((await app.inject({ method: 'POST', url: `/captures/${caps[1].id}/recapture`, headers: auth(u) })).statusCode).toBe(409);
    const stranger = await makeUser();
    expect((await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/recapture`, headers: auth(stranger) })).statusCode).toBe(404);
    const list = (await app.inject({ url: `/projects/${project.id}/captures`, headers: auth(u) })).json().captures;
    expect(list.map((c: any) => c.device)).toEqual(['desktop', 'tablet', 'mobile']);
  });
});

describe('[CE-9-UI] failed cells keep their reason and can be retried', () => {
  it('lists the reason and retries a failed capture', async () => {
    const { u, project, caps } = await setup('failed');
    const list = (await app.inject({ url: `/projects/${project.id}/captures`, headers: auth(u) })).json().captures;
    expect(list[0]).toMatchObject({ status: 'failed', error: 'The page took longer than 45 seconds to load', image_url: null });
    await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/recapture`, headers: auth(u) });
    const [row] = await query('SELECT status, error FROM captures WHERE id = $1', [caps[0].id]);
    expect(row).toEqual({ status: 'queued', error: null });
  });
});

describe('[UP-1] upload my own screenshot', () => {
  it('replaces the cell with a validated image marked source=upload', async () => {
    const { u, project, caps } = await setup('failed');
    const res = await app.inject({ method: 'POST', url: `/captures/${caps[2].id}/upload`, ...multipart(u, 'mine.png', pngBytes(390, 844)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().capture).toMatchObject({ status: 'done', source: 'upload', width: 390, height: 844, error: null });
    expect(res.json().capture.image_url).toMatch(/\/files\/captures\//);
    const [row] = await query('SELECT image_key FROM captures WHERE id = $1', [caps[2].id]);
    expect((await getStorage().get(row.image_key)).subarray(1, 4).toString()).toBe('PNG');
    expect(row.image_key).toContain(project.id);
  });

  it('rejects non-images, wrong types disguised by MIME, and missing files', async () => {
    const { u, caps } = await setup('failed');
    const text = await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/upload`, ...multipart(u, 'x.png', Buffer.from('hello world'), 'image/png') });
    expect(text.statusCode).toBe(422);
    expect(text.json().error).toBe('bad_type');
    const gif = await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/upload`, ...multipart(u, 'x.gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;'), 'image/gif') });
    expect(gif.statusCode).toBe(422);
    const none = await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/upload`, headers: { ...auth(u), 'content-type': 'application/json' }, payload: '{}' });
    expect(none.statusCode).toBe(400);
    const big = Buffer.alloc(26 * 1024 * 1024);
    pngBytes().copy(big);
    const huge = await app.inject({ method: 'POST', url: `/captures/${caps[0].id}/upload`, ...multipart(u, 'big.png', big) });
    expect([413, 422]).toContain(huge.statusCode);
  });

  it('identifies images from their bytes', () => {
    expect(inspectImage(pngBytes(12, 7))).toEqual({ type: 'png', width: 12, height: 7 });
    expect(() => inspectImage(Buffer.alloc(0))).toThrow('empty');
    expect(() => inspectImage(pngBytes(), ['jpg'])).toThrow('Upload a JPG image');
  });
});
