import { randomUUID } from 'node:crypto';
import { getPool, one, query } from './db';
import { contentTypes, ImageError, inspectImage } from './images';
import { enqueue } from './queue';
import { validateScreens, type ScreenDef } from './screens';
import { getStorage } from './storage';

export const MIN_LONG_SIDE = 3000; // CP-1
export const DEVICE_TYPES = ['desktop', 'laptop', 'tablet', 'mobile', 'multi'] as const;
export const SCENES = ['desk', 'hand', 'studio', 'outdoor'] as const;
export const TONES = ['light', 'dark', 'warm', 'cool'] as const;
export const ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;

export class MockupError extends Error {
  statusCode = 422;
  constructor(message: string, public code = 'bad_mockup', public details?: string[]) {
    super(message);
  }
}

export function orientationOf(w: number, h: number): (typeof ORIENTATIONS)[number] {
  if (Math.abs(w - h) / Math.max(w, h) < 0.05) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

export interface MockupRow {
  id: string;
  title: string;
  photo_key: string;
  thumb_key: string | null;
  width: number;
  height: number;
  orientation: string;
  tags: string[];
  scene: string | null;
  device_type: string | null;
  tone: string | null;
  licence_source: string | null;
  licence_type: string | null;
  attribution: string | null;
  attribution_required: boolean;
  overlay_key: string | null;
  light_map_key: string | null;
  status: 'draft' | 'published';
}

/** CP-1: JPG/PNG, at least 3000 px on the long side. */
export async function createMockup(userId: string, buf: Buffer, filename = 'Untitled'): Promise<MockupRow> {
  const img = inspectImage(buf, ['jpg', 'png']);
  if (Math.max(img.width, img.height) < MIN_LONG_SIDE) {
    throw new ImageError(`The photo must be at least ${MIN_LONG_SIDE} px on its long side (this one is ${Math.max(img.width, img.height)} px)`, 'too_small');
  }
  const id = randomUUID();
  const key = `mockups/${id}/photo.${img.type}`;
  await getStorage().put(key, buf, contentTypes[img.type]);
  const title = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 120) || 'Untitled';
  const row = (await one<MockupRow>(
    `INSERT INTO mockups(id, title, photo_key, width, height, orientation, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, title, key, img.width, img.height, orientationOf(img.width, img.height), userId],
  ))!;
  await enqueue('render', { kind: 'thumbnail', mockupId: id });
  return row;
}

const str = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);
function oneOf<T extends readonly string[]>(v: unknown, list: T, name: string): T[number] | null {
  if (v == null || v === '') return null;
  if (!list.includes(v as string)) throw new MockupError(`${name} must be one of ${list.join(', ')}`);
  return v as T[number];
}

/** CP-7 metadata. */
export async function updateMockupMeta(id: string, input: Record<string, any>): Promise<MockupRow | undefined> {
  const current = await one<MockupRow>('SELECT * FROM mockups WHERE id = $1', [id]);
  if (!current) return undefined;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const tags = has('tags')
    ? (Array.isArray(input.tags) ? input.tags : String(input.tags ?? '').split(','))
        .map((t: unknown) => String(t).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20)
    : current.tags;
  const next = {
    title: has('title') ? str(input.title, 120) ?? current.title : current.title,
    tags,
    scene: has('scene') ? oneOf(input.scene, SCENES, 'Scene') : current.scene,
    device_type: has('device_type') ? oneOf(input.device_type, DEVICE_TYPES, 'Device type') : current.device_type,
    tone: has('tone') ? oneOf(input.tone, TONES, 'Colour tone') : current.tone,
    licence_source: has('licence_source') ? str(input.licence_source, 300) : current.licence_source,
    licence_type: has('licence_type') ? str(input.licence_type, 120) : current.licence_type,
    attribution: has('attribution') ? str(input.attribution, 500) : current.attribution,
    attribution_required: has('attribution_required') ? Boolean(input.attribution_required) : current.attribution_required,
  };
  const updated = (await one<MockupRow>(
    `UPDATE mockups SET title=$2, tags=$3, scene=$4, device_type=$5, tone=$6, licence_source=$7, licence_type=$8, attribution=$9, attribution_required=$10
      WHERE id = $1 RETURNING *`,
    [id, next.title, next.tags, next.scene, next.device_type, next.tone, next.licence_source, next.licence_type, next.attribution, next.attribution_required],
  ))!;
  // A published mockup must stay publishable.
  if (updated.status === 'published') {
    const problems = await publishProblems(updated);
    if (problems.length) {
      await query(
        `UPDATE mockups SET title=$2, tags=$3, scene=$4, device_type=$5, tone=$6, licence_source=$7, licence_type=$8, attribution=$9, attribution_required=$10 WHERE id=$1`,
        [id, current.title, current.tags, current.scene, current.device_type, current.tone, current.licence_source, current.licence_type, current.attribution, current.attribution_required],
      );
      throw new MockupError('A published mockup needs its licence information', 'licence_required', problems);
    }
  }
  return updated;
}

/** Masks are either a shared library mask (masks/...) or one uploaded for this mockup, and must exist. */
async function checkMask(mockupId: string, key: string | null | undefined) {
  if (!key) return;
  const own = new RegExp(`^mockups/${mockupId}/mask-[a-z0-9_-]{1,20}-\\d+\\.png$`, 'i');
  if (!(/^masks\/[a-z0-9_.-]+\.png$/i.test(key) || own.test(key)) || !(await getStorage().exists(key))) {
    throw new MockupError('Upload the mask PNG for this screen again', 'bad_mask');
  }
}

export async function setScreens(mockup: MockupRow, input: unknown): Promise<ScreenDef[]> {
  const screens = validateScreens(input, mockup);
  for (const s of screens) await checkMask(mockup.id, s.maskUrl);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM screens WHERE mockup_id = $1', [mockup.id]);
    for (const s of screens) {
      await client.query(
        'INSERT INTO screens(mockup_id, screen_key, device, corners, corner_radius, mask_key, z_index) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [mockup.id, s.screenId, s.device, JSON.stringify(s.corners), Math.round(s.cornerRadius ?? 0), s.maskUrl ?? null, s.zIndex ?? 1],
      );
    }
    if (!screens.length && mockup.status === 'published') throw new MockupError('A published mockup needs at least one screen', 'no_screens');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return screens;
}

export async function getScreens(mockupId: string) {
  return query('SELECT screen_key, device, corners, corner_radius, mask_key, z_index FROM screens WHERE mockup_id = $1 ORDER BY z_index, screen_key', [mockupId]);
}

/** CP-7: what stops a mockup from being published. */
export async function publishProblems(m: MockupRow): Promise<string[]> {
  const problems: string[] = [];
  if (!m.licence_source) problems.push('Licence source is required');
  if (!m.licence_type) problems.push('Licence type is required');
  if (m.attribution_required && !m.attribution) problems.push('Attribution text is required by this licence');
  const n = (await one<{ n: number }>('SELECT count(*)::int AS n FROM screens WHERE mockup_id = $1', [m.id]))!.n;
  if (!n) problems.push('Mark at least one screen');
  return problems;
}

/** CP-8: only published mockups reach users. */
export async function setStatus(id: string, status: 'draft' | 'published'): Promise<MockupRow> {
  const m = await one<MockupRow>('SELECT * FROM mockups WHERE id = $1', [id]);
  if (!m) throw new MockupError('Mockup not found', 'not_found');
  if (status === 'published') {
    const problems = await publishProblems(m);
    if (problems.length) throw new MockupError(problems.join('. '), 'not_publishable', problems);
  }
  return (await one<MockupRow>('UPDATE mockups SET status = $2 WHERE id = $1 RETURNING *', [id, status]))!;
}

export interface LibraryFilter {
  device?: string;
  scene?: string;
  tone?: string;
  orientation?: string;
  q?: string;
}

export async function listMockups(filter: LibraryFilter, opts: { includeDrafts?: boolean } = {}): Promise<MockupRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (!opts.includeDrafts) where.push("status = 'published'");
  if (filter.device) add('device_type = ?', filter.device);
  if (filter.scene) add('scene = ?', filter.scene);
  if (filter.tone) add('tone = ?', filter.tone);
  if (filter.orientation) add('orientation = ?', filter.orientation);
  if (filter.q) {
    params.push(`%${filter.q.toLowerCase()}%`);
    where.push(`(lower(title) LIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE t LIKE $${params.length}))`);
  }
  return query<MockupRow>(`SELECT * FROM mockups ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, title LIMIT 500`, params);
}

export async function withUrls(m: MockupRow) {
  const s = getStorage();
  return {
    ...m,
    photo_url: await s.signedUrl(m.photo_key),
    thumb_url: await s.signedUrl(m.thumb_key ?? m.photo_key),
    overlay_url: m.overlay_key ? await s.signedUrl(m.overlay_key) : null,
    light_map_url: m.light_map_key ? await s.signedUrl(m.light_map_key) : null,
  };
}
