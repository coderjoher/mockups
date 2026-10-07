import { one, query } from './db';
import { enqueue } from './queue';
import { getStorage } from './storage';
import { DEVICES, type Device } from './viewports';

export class RenderError extends Error {
  statusCode = 422;
  constructor(message: string, public code = 'bad_render') {
    super(message);
  }
}

export interface Assignment {
  captureId: string;
  scrollOffset?: number;
}

interface ScreenRow { screen_key: string; device: Device; corners: Record<string, [number, number]>; z_index: number }
interface CaptureRow { id: string; page_id: string; device: Device; mode: 'fold' | 'full'; page_order: number; height: number }

function area(c: ScreenRow['corners']): number {
  const p = ['tl', 'tr', 'br', 'bl'].map((k) => c[k]);
  let s = 0;
  for (let i = 0; i < 4; i++) s += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1];
  return Math.abs(s / 2);
}

/** Nearest device when a page has no capture for the screen's own device. */
const FALLBACK: Record<Device, Device[]> = { desktop: ['desktop', 'tablet', 'mobile'], tablet: ['tablet', 'desktop', 'mobile'], mobile: ['mobile', 'tablet', 'desktop'] };

/**
 * CR-2 defaults: the largest screen shows Home, the other screens show the next pages in checklist order
 * (wrapping round), each using the capture for the screen's device. Above-the-fold captures are preferred.
 */
export function defaultAssignments(screens: ScreenRow[], captures: CaptureRow[], pageOrder?: string[]): Record<string, Assignment> {
  const pages = pageOrder ?? [...new Set([...captures].sort((a, b) => a.page_order - b.page_order).map((c) => c.page_id))];
  const byScreen = [...screens].sort((a, b) => area(b.corners) - area(a.corners));
  const out: Record<string, Assignment> = {};
  byScreen.forEach((s, i) => {
    const pageId = pages[i % Math.max(1, pages.length)];
    const pick = (pid: string) => {
      for (const d of FALLBACK[s.device]) {
        const c = captures.find((x) => x.page_id === pid && x.device === d && x.mode === 'fold') ?? captures.find((x) => x.page_id === pid && x.device === d);
        if (c) return c;
      }
      return undefined;
    };
    const c = (pageId && pick(pageId)) ?? pages.map(pick).find(Boolean);
    if (c) out[s.screen_key] = { captureId: c.id, scrollOffset: 0 };
  });
  return out;
}

export async function loadRenderInputs(projectId: string, mockupId: string, opts: { allowDraft?: boolean } = {}) {
  const mockup = await one('SELECT * FROM mockups WHERE id = $1', [mockupId]);
  if (!mockup || (mockup.status !== 'published' && !opts.allowDraft)) throw new RenderError('Mockup not found', 'not_found');
  const screens = await query<ScreenRow>('SELECT screen_key, device, corners, z_index FROM screens WHERE mockup_id = $1', [mockupId]);
  const captures = await query<CaptureRow>(
    `SELECT c.id, c.page_id, c.device, c.mode, c.height, p."order" AS page_order FROM captures c JOIN pages p ON p.id = c.page_id
      WHERE p.project_id = $1 AND c.status = 'done' ORDER BY p."order"`,
    [projectId],
  );
  return { mockup, screens, captures };
}

export function validateAssignments(input: unknown, screens: ScreenRow[], captures: CaptureRow[]): Record<string, Assignment> {
  if (!input || typeof input !== 'object') throw new RenderError('assignments must be an object');
  const out: Record<string, Assignment> = {};
  for (const [key, a] of Object.entries(input as Record<string, any>)) {
    if (!screens.some((s) => s.screen_key === key)) throw new RenderError(`Unknown screen ${key}`);
    const cap = captures.find((c) => c.id === a?.captureId);
    if (!cap) throw new RenderError(`Screen ${key}: pick a finished capture from this project`);
    const scrollOffset = Math.max(0, Math.round(Number(a.scrollOffset ?? 0)) || 0);
    out[key] = { captureId: cap.id, scrollOffset };
  }
  return out;
}

export async function createRender(projectId: string, mockupId: string, assignmentsInput: unknown, opts: { preview?: boolean; formats?: string[]; layout?: string; options?: Record<string, unknown> } = {}) {
  const { screens, captures } = await loadRenderInputs(projectId, mockupId);
  if (!captures.length) throw new RenderError('Capture at least one page first', 'no_captures');
  const assignments = assignmentsInput && Object.keys(assignmentsInput as object).length
    ? { ...defaultAssignments(screens, captures), ...validateAssignments(assignmentsInput, screens, captures) }
    : defaultAssignments(screens, captures);
  const render = (await one(
    'INSERT INTO renders(project_id, mockup_id, assignments, options) VALUES ($1,$2,$3,$4) RETURNING *',
    [projectId, mockupId, JSON.stringify(assignments), JSON.stringify({ preview: !!opts.preview, formats: opts.formats ?? ['png'], ...(opts.options ?? {}) })],
  ))!;
  const jobId = await enqueue('render', { kind: 'render', renderId: render.id }, projectId);
  return { render, jobId };
}

export async function renderWithUrls(r: any) {
  const s = getStorage();
  const urls: Record<string, string> = {};
  const downloads: Record<string, string> = {};
  const { downloadName } = await import('./exports');
  for (const [k, key] of Object.entries((r.outputs ?? {}) as Record<string, string>)) {
    urls[k] = await s.signedUrl(key);
    if (k !== 'preview' && r.status === 'done') downloads[k] = `${urls[k]}&dl=${encodeURIComponent(await downloadName(r.id, key.split('.').pop()!))}`;
  }
  return { ...r, urls, downloads };
}

export { DEVICES };
/** CR-4 batch mode: one mockup applied to every captured page; every screen of a render shows that page. */
export async function createBatch(projectId: string, mockupId: string, formats: string[] = ['png']) {
  const { screens, captures } = await loadRenderInputs(projectId, mockupId);
  const pageIds = [...new Set(captures.map((c) => c.page_id))];
  if (!pageIds.length) throw new RenderError('Capture at least one page first', 'no_captures');
  const out = [];
  for (const pageId of pageIds) {
    const assignments = defaultAssignments(screens, captures, [pageId]);
    const render = (await one(
      'INSERT INTO renders(project_id, mockup_id, assignments, options) VALUES ($1,$2,$3,$4) RETURNING *',
      [projectId, mockupId, JSON.stringify(assignments), JSON.stringify({ preview: false, formats, batch: true })],
    ))!;
    await enqueue('render', { kind: 'render', renderId: render.id }, projectId);
    out.push(render);
  }
  return out;
}

export const LAYOUTS = ['grid', 'tall'] as const;

/** CR-5 / CX-2: photo-free layouts (grid collage of pages, or one full page in a tall frame). */
export async function createLayoutRender(
  projectId: string,
  layout: string,
  captureIds: string[],
  style: { bg?: unknown; padding?: unknown; shadow?: unknown; preview?: boolean; formats?: string[]; headline?: unknown; logoKey?: unknown; presets?: unknown } = {},
) {
  if (!LAYOUTS.includes(layout as any)) throw new RenderError('layout must be grid or tall');
  const caps = await query("SELECT c.id FROM captures c JOIN pages p ON p.id = c.page_id WHERE p.project_id = $1 AND c.status = 'done' AND c.id = ANY($2::uuid[])", [projectId, captureIds]);
  const ordered = captureIds.filter((id) => caps.some((c) => c.id === id));
  if (!ordered.length) throw new RenderError('Pick at least one finished capture');
  if (layout === 'tall' && ordered.length !== 1) throw new RenderError('The tall frame shows one page');
  const options: Record<string, unknown> = { preview: !!style.preview, formats: style.formats ?? ['png'] };
  if (style.bg !== undefined) options.bg = validateBackground(style.bg);
  if (style.padding !== undefined) options.padding = clampInt(style.padding, 0, 400, 'padding');
  if (style.shadow !== undefined) options.shadow = clampNum(style.shadow, 0, 1, 'shadow');
  if (style.headline) options.headline = String(style.headline).slice(0, 120);
  if (style.logoKey) {
    if (!new RegExp(`^projects/${projectId}/logo-\\d+\\.(png|jpg|webp)$`).test(String(style.logoKey))) throw new RenderError('Upload the logo again');
    options.logoKey = String(style.logoKey);
  }
  if (style.presets !== undefined) options.presets = validatePresets(style.presets);
  const render = (await one(
    'INSERT INTO renders(project_id, mockup_id, layout, assignments, options) VALUES ($1,NULL,$2,$3,$4) RETURNING *',
    [projectId, layout, JSON.stringify({ pages: ordered.slice(0, 12).map((captureId) => ({ captureId })) }), JSON.stringify(options)],
  ))!;
  const jobId = await enqueue('render', { kind: 'render', renderId: render.id }, projectId);
  return { render, jobId };
}

export const PRESETS = ['ig_post', 'ig_story', 'linkedin', 'behance', 'slide', '4k'] as const;
export function validatePresets(input: unknown): string[] {
  if (!Array.isArray(input) || input.some((p) => !PRESETS.includes(p))) throw new RenderError(`Presets must be among ${PRESETS.join(', ')}`);
  return [...new Set(input as string[])];
}

const HEX = /^#[0-9a-f]{6}$/i;
/** CX-2 background: solid colour or two-colour gradient. */
export function validateBackground(bg: any): Record<string, unknown> {
  if (bg?.type === 'solid' && HEX.test(bg.colour)) return { type: 'solid', colour: bg.colour };
  if (bg?.type === 'gradient' && HEX.test(bg.from) && HEX.test(bg.to)) return { type: 'gradient', from: bg.from, to: bg.to, angle: clampNum(bg.angle ?? 135, 0, 360, 'angle') };
  throw new RenderError('Background must be a #rrggbb colour or a gradient between two colours');
}
function clampNum(v: unknown, min: number, max: number, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new RenderError(`${name} must be between ${min} and ${max}`);
  return n;
}
function clampInt(v: unknown, min: number, max: number, name: string): number {
  return Math.round(clampNum(v, min, max, name));
}
