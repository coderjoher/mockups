import { one, query } from './db';
import { extractFavicon, extractTitle, htmlLang } from './html';
import { logDomain } from './ratelimit';
import { safeFetch } from './ssrf';
import { normaliseUrl, UrlError } from './url';
import type { User } from './users';

export interface Project {
  id: string;
  workspace_id: string;
  owner_id: string;
  root_url: string;
  title: string;
  language: string;
  viewports: Record<string, any>;
  discovery: any;
  saved: boolean;
  created_at: Date;
}

/** PD-1: normalise the URL, load it through the SSRF guard and confirm it is a working HTML page. */
export async function checkSite(input: string): Promise<{ url: string; title: string; favicon: string; lang?: string }> {
  const url = normaliseUrl(input);
  const res = await safeFetch(url, { timeoutMs: 20_000 });
  if (res.status >= 400) throw new UrlError(`The site did not load (HTTP ${res.status})`, 'unreachable');
  const type = res.headers.get('content-type') ?? '';
  if (!/html/i.test(type)) throw new UrlError('That link is not a web page', 'not_html');
  const html = res.body.toString('utf8');
  const finalUrl = normaliseUrl(res.url);
  return { url: finalUrl, title: extractTitle(html) || new URL(finalUrl).hostname, favicon: extractFavicon(html, finalUrl), lang: htmlLang(html) };
}

export async function createProject(user: User, input: string): Promise<Project> {
  const site = await checkSite(input);
  await logDomain(user.id, site.url, 'check');
  const project = (await one<Project>(
    'INSERT INTO projects(workspace_id, owner_id, root_url, title, language) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [user.workspace_id, user.id, site.url, site.title, site.lang?.startsWith('ar') ? 'ar' : 'en'],
  ))!;
  // Home page is always the first page and pre-selected (PD-5).
  await query('INSERT INTO pages(project_id, url, title, favicon_url, "order", selected) VALUES ($1,$2,$3,$4,0,true)', [project.id, site.url, site.title, site.favicon]);
  return project;
}

export async function getProject(user: User, id: string): Promise<Project | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return one<Project>('SELECT * FROM projects WHERE id = $1 AND workspace_id = $2', [id, user.workspace_id]);
}

export async function listProjects(user: User): Promise<Project[]> {
  return query<Project>(
    `SELECT p.*, (SELECT count(*) FROM pages WHERE project_id = p.id AND selected) AS selected_pages
       FROM projects p WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [user.workspace_id],
  );
}
