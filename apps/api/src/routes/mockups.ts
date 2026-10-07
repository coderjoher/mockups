import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one } from '@mockups/core/db';
import { contentTypes, inspectImage } from '@mockups/core/images';
import {
  createMockup, DEVICE_TYPES, getScreens, listMockups, MockupError, ORIENTATIONS, SCENES, setScreens, setStatus, TONES, updateMockupMeta, withUrls,
  type MockupRow,
} from '@mockups/core/mockups';
import { ScreenError } from '@mockups/core/screens';
import { getStorage } from '@mockups/core/storage';
import { HttpError, requireAdmin, requireUser } from '../app';

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

async function upload(req: FastifyRequest): Promise<{ buf: Buffer; filename: string }> {
  const file = await req.file().catch(() => undefined);
  if (!file) throw new HttpError(400, 'Attach an image file', 'no_file');
  const buf = await file.toBuffer().catch(() => {
    throw new HttpError(413, 'The file is larger than 25 MB', 'too_large');
  });
  return { buf, filename: file.filename };
}

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof MockupError || err instanceof ScreenError) throw Object.assign(new HttpError(422, err.message, (err as any).code), { details: (err as any).details });
    throw err;
  });
}

async function full(m: MockupRow) {
  return { ...(await withUrls(m)), screens: await getScreensWithUrls(m.id) };
}

async function getScreensWithUrls(id: string) {
  const rows = await getScreens(id);
  return Promise.all(rows.map(async (s: any) => ({ ...s, mask_url: s.mask_key ? await getStorage().signedUrl(s.mask_key) : null })));
}

export async function mockupRoutes(app: FastifyInstance) {
  // ML-1: the user-side library (published only, CP-8).
  app.get<{ Querystring: Record<string, string> }>('/mockups', async (req) => {
    await requireUser(req);
    const { device, scene, tone, orientation, q } = req.query;
    const rows = await listMockups({ device, scene, tone, orientation, q });
    return { mockups: await Promise.all(rows.map(full)), filters: { device: DEVICE_TYPES, scene: SCENES, tone: TONES, orientation: ORIENTATIONS } };
  });

  app.get<{ Params: { id: string } }>('/mockups/:id', async (req) => {
    const user = await requireUser(req);
    const m = isId(req.params.id) ? await one<MockupRow>('SELECT * FROM mockups WHERE id = $1', [req.params.id]) : undefined;
    if (!m || (m.status !== 'published' && user.role !== 'admin')) throw new HttpError(404, 'Mockup not found');
    return { mockup: await full(m) };
  });

  // Admin corner picker (CP-1..CP-8).
  app.get<{ Querystring: Record<string, string> }>('/admin/mockups', async (req) => {
    await requireAdmin(req);
    return { mockups: await Promise.all((await listMockups(req.query, { includeDrafts: true })).map(full)) };
  });

  app.post('/admin/mockups', async (req, reply) => {
    const admin = await requireAdmin(req);
    const { buf, filename } = await upload(req);
    const m = await createMockup(admin.id, buf, filename);
    return reply.status(201).send({ mockup: await full(m) });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/admin/mockups/:id', async (req) => {
    await requireAdmin(req);
    if (!isId(req.params.id)) throw new HttpError(404, 'Mockup not found');
    const m = await wrap(() => updateMockupMeta(req.params.id, req.body ?? {}));
    if (!m) throw new HttpError(404, 'Mockup not found');
    return { mockup: await full(m) };
  });

  app.put<{ Params: { id: string }; Body: { screens?: unknown } }>('/admin/mockups/:id/screens', async (req) => {
    await requireAdmin(req);
    const m = isId(req.params.id) ? await one<MockupRow>('SELECT * FROM mockups WHERE id = $1', [req.params.id]) : undefined;
    if (!m) throw new HttpError(404, 'Mockup not found');
    await wrap(() => setScreens(m, req.body?.screens));
    return { mockup: await full(m) };
  });

  // CP-4 masks and CP-5 overlay / CP-6 light map images.
  app.post<{ Params: { id: string; kind: string } }>('/admin/mockups/:id/assets/:kind', async (req) => {
    await requireAdmin(req);
    const m = isId(req.params.id) ? await one<MockupRow>('SELECT * FROM mockups WHERE id = $1', [req.params.id]) : undefined;
    if (!m) throw new HttpError(404, 'Mockup not found');
    const kind = req.params.kind;
    if (!/^(mask-[a-z0-9_-]{1,20}|overlay|lightmap)$/i.test(kind)) throw new HttpError(400, 'Unknown asset');
    const { buf } = await upload(req);
    const img = inspectImage(buf, kind === 'lightmap' ? ['png', 'jpg'] : ['png']);
    const key = `mockups/${m.id}/${kind}-${Date.now()}.${img.type}`;
    await getStorage().put(key, buf, contentTypes[img.type]);
    return { key, url: await getStorage().signedUrl(key), width: img.width, height: img.height };
  });

  app.post<{ Params: { id: string } }>('/admin/mockups/:id/publish', async (req) => {
    await requireAdmin(req);
    if (!isId(req.params.id)) throw new HttpError(404, 'Mockup not found');
    return { mockup: await full(await wrap(() => setStatus(req.params.id, 'published'))) };
  });

  app.post<{ Params: { id: string } }>('/admin/mockups/:id/unpublish', async (req) => {
    await requireAdmin(req);
    if (!isId(req.params.id)) throw new HttpError(404, 'Mockup not found');
    return { mockup: await full(await wrap(() => setStatus(req.params.id, 'draft'))) };
  });

  app.delete<{ Params: { id: string } }>('/admin/mockups/:id', async (req) => {
    await requireAdmin(req);
    if (!isId(req.params.id)) throw new HttpError(404, 'Mockup not found');
    await one('DELETE FROM mockups WHERE id = $1', [req.params.id]);
    return { ok: true };
  });
}
