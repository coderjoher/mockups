import { one, query } from './db';
import { exportName, siteName, uniqueNames } from './filenames';
import { enqueue } from './queue';
import { createLayoutRender, createRender, RenderError } from './renders';
import { getStorage } from './storage';

export const FORMATS = ['png', 'webp', 'jpg'] as const;
export type Format = (typeof FORMATS)[number];

function area(c: Record<string, [number, number]>): number {
  const p = ['tl', 'tr', 'br', 'bl'].map((k) => c[k]);
  let s = 0;
  for (let i = 0; i < 4; i++) s += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1];
  return Math.abs(s / 2);
}

/** EX-3 name parts for a render: the page and device of its largest screen; several device kinds read "multi". */
export async function renderNameParts(renderId: string): Promise<{ site: string; page: string; device: string; mockup: string }> {
  const r = await one(
    `SELECT r.*, p.root_url, m.title AS mockup_title FROM renders r JOIN projects p ON p.id = r.project_id LEFT JOIN mockups m ON m.id = r.mockup_id WHERE r.id = $1`,
    [renderId],
  );
  if (!r) throw new RenderError('Render not found', 'not_found');
  if (r.layout && r.layout !== 'mockup') {
    const first = r.assignments?.pages?.[0]?.captureId;
    const pg = first ? await one('SELECT pg.title, pg.url FROM captures c JOIN pages pg ON pg.id = c.page_id WHERE c.id = $1', [first]) : undefined;
    const many = (r.assignments?.pages?.length ?? 0) > 1;
    return { site: siteName(r.root_url), page: many ? 'all-pages' : pg?.title || 'page', device: 'layout', mockup: r.layout === 'grid' ? 'grid' : 'tall-frame' };
  }
  const screens = await query('SELECT screen_key, device, corners FROM screens WHERE mockup_id = $1', [r.mockup_id]);
  const main = [...screens].sort((a, b) => area(b.corners) - area(a.corners))[0];
  const devices = new Set(screens.map((s) => s.device));
  let page = 'page';
  const capId = main ? r.assignments?.[main.screen_key]?.captureId : undefined;
  if (capId) {
    const pg = await one('SELECT pg.title, pg.url FROM captures c JOIN pages pg ON pg.id = c.page_id WHERE c.id = $1', [capId]);
    if (pg) page = pg.title || new URL(pg.url).pathname;
  }
  return { site: siteName(r.root_url), page, device: devices.size > 1 ? 'multi' : (main?.device ?? 'device'), mockup: r.mockup_title ?? 'mockup' };
}

export async function downloadName(renderId: string, ext: string): Promise<string> {
  return exportName({ ...(await renderNameParts(renderId)), ext });
}

/**
 * EX-3: ZIP of the whole set. Every final render in the project (latest per mockup + assignment) is rendered again
 * in the requested formats (renders are deterministic, CR-7), then the export job zips them.
 */
export async function createExport(projectId: string, formats: string[], renderIds?: string[], presetsInput?: unknown, bg?: unknown): Promise<{ jobId: string; renderIds: string[] }> {
  const { validatePresets, validateBackground } = await import('./renders');
  const presets = presetsInput === undefined ? [] : validatePresets(presetsInput);
  const background = bg === undefined || bg === null ? undefined : validateBackground(bg);
  const fmts = FORMATS.filter((f) => formats.includes(f));
  if (!fmts.length) throw new RenderError('Choose at least one format (PNG, WebP or JPG)', 'no_formats');
  const sources = renderIds?.length
    ? await query("SELECT * FROM renders WHERE project_id = $1 AND id = ANY($2::uuid[]) AND status = 'done'", [projectId, renderIds])
    : await query(
        `SELECT DISTINCT ON (mockup_id, assignments::text) * FROM renders
          WHERE project_id = $1 AND status = 'done' AND NOT COALESCE((options->>'preview')::boolean, false)
          ORDER BY mockup_id, assignments::text, created_at DESC`,
        [projectId],
      );
  if (!sources.length) throw new RenderError('Render at least one mockup at full size first', 'nothing_to_export');
  const ids: string[] = [];
  for (const s of sources) {
    const extra = { presets, ...(background ? { bg: background } : {}) };
    if (s.layout && s.layout !== 'mockup') {
      const { render } = await createLayoutRender(projectId, s.layout, (s.assignments?.pages ?? []).map((p: any) => p.captureId), {
        ...Object.fromEntries(['bg', 'padding', 'shadow', 'headline', 'logoKey'].filter((k) => s.options?.[k] !== undefined).map((k) => [k, s.options[k]])),
        formats: [...fmts],
        ...extra,
      });
      ids.push(render.id);
      continue;
    }
    const { render } = await createRender(projectId, s.mockup_id, s.assignments, { formats: [...fmts], options: { batch: s.options?.batch, ...extra } });
    ids.push(render.id);
  }
  const jobId = await enqueue('export', { projectId, renderIds: ids, formats: fmts, presets }, projectId);
  return { jobId, renderIds: ids };
}

/** EX-6: attribution text for every licence in the set that requires it. */
export async function attributionText(renderIds: string[]): Promise<string | null> {
  const rows = await query(
    `SELECT DISTINCT m.title, m.licence_source, m.licence_type, m.attribution FROM renders r JOIN mockups m ON m.id = r.mockup_id
      WHERE r.id = ANY($1::uuid[]) AND m.attribution_required ORDER BY m.title`,
    [renderIds],
  );
  if (!rows.length) return null;
  return [
    'Mockup photo credits',
    '',
    ...rows.map((m) => `${m.title}\n  ${m.attribution}\n  Licence: ${m.licence_type}\n  Source: ${m.licence_source}\n`),
  ].join('\n');
}

export async function exportStatus(jobId: string, projectId: string) {
  const job = await one("SELECT * FROM jobs WHERE id = $1 AND project_id = $2 AND type = 'export'", [jobId, projectId]);
  if (!job) return undefined;
  const url = job.status === 'done' && job.result?.zipKey ? await getStorage().signedUrl(job.result.zipKey) : null;
  return { status: job.status, error: job.error, url, files: job.result?.files ?? [] };
}

export { uniqueNames };
