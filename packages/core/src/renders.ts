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
  for (const [k, key] of Object.entries((r.outputs ?? {}) as Record<string, string>)) urls[k] = await s.signedUrl(key);
  return { ...r, urls };
}

export { DEVICES };
