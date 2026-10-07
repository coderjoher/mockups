import { one, query } from './db';

export const MAX_SELECTED_PAGES = 20; // PD-9

export interface PageRow {
  id: string;
  project_id: string;
  url: string;
  title: string;
  favicon_url: string | null;
  template_group: string | null;
  lang: string | null;
  order: number;
  selected: boolean;
  source: 'discovered' | 'manual';
}

export class SelectionLimitError extends Error {
  statusCode = 422;
  code = 'selection_limit';
  constructor() {
    super(`You can select up to ${MAX_SELECTED_PAGES} pages per project`);
  }
}

/** Human title from a URL path when the page title is unknown: "/about-us/" -> "About us". */
export function titleFromPath(url: string): string {
  const u = new URL(url);
  const last = decodeURIComponent(u.pathname).split('/').filter(Boolean).pop();
  if (!last) return 'Home';
  const words = last.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Home';
}

export async function listPages(projectId: string, q?: string): Promise<PageRow[]> {
  const params: unknown[] = [projectId];
  let filter = '';
  if (q?.trim()) {
    params.push(`%${q.trim().toLowerCase()}%`);
    filter = 'AND (lower(title) LIKE $2 OR lower(url) LIKE $2)';
  }
  return query<PageRow>(`SELECT * FROM pages WHERE project_id = $1 ${filter} ORDER BY "order", url`, params);
}

export async function setSelected(projectId: string, pageIds: string[], selected: boolean): Promise<void> {
  if (selected) {
    const { n } = (await one<{ n: number }>(
      'SELECT count(*)::int AS n FROM pages WHERE project_id = $1 AND (selected OR id = ANY($2::uuid[]))',
      [projectId, pageIds],
    ))!;
    if (n > MAX_SELECTED_PAGES) throw new SelectionLimitError();
  }
  await query('UPDATE pages SET selected = $3 WHERE project_id = $1 AND id = ANY($2::uuid[])', [projectId, pageIds, selected]);
}

export async function upsertPages(
  projectId: string,
  pages: { url: string; title: string; favicon_url?: string | null; template_group?: string | null; lang?: string | null; source?: 'discovered' | 'manual'; selected?: boolean }[],
): Promise<void> {
  const { max } = (await one<{ max: number }>('SELECT COALESCE(max("order"), 0)::int AS max FROM pages WHERE project_id = $1', [projectId]))!;
  let order = max;
  for (const p of pages) {
    await query(
      `INSERT INTO pages(project_id, url, title, favicon_url, template_group, lang, source, selected, "order")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (project_id, url) DO UPDATE SET
         title = CASE WHEN pages.title = '' THEN EXCLUDED.title ELSE pages.title END,
         favicon_url = COALESCE(pages.favicon_url, EXCLUDED.favicon_url),
         template_group = EXCLUDED.template_group,
         lang = COALESCE(EXCLUDED.lang, pages.lang)`,
      [projectId, p.url, p.title, p.favicon_url ?? null, p.template_group ?? null, p.lang ?? null, p.source ?? 'discovered', p.selected ?? false, ++order],
    );
  }
}
