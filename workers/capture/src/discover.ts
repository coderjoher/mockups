// PD-2..PD-4: find a site's pages from robots.txt/sitemaps, or by crawling its links.
import { gunzipSync } from 'node:zlib';
import { one, query } from '@mockups/core/db';
import { extractAlternates, extractFavicon, extractLinks, extractTitle, htmlLang } from '@mockups/core/html';
import { titleFromPath, upsertPages } from '@mockups/core/pages';
import { logDomain } from '@mockups/core/ratelimit';
import { safeFetch } from '@mockups/core/ssrf';
import { normaliseUrl, sameSite } from '@mockups/core/url';
import { detectLanguage, templateGroups } from '@mockups/core/grouping';

export const DEFAULT_MAX_URLS = 200;
export const DEFAULT_TIME_LIMIT_MS = 30_000;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|gz|mp4|mp3|webm|docx?|xlsx?|pptx?|css|js|json|xml|txt|woff2?|ttf)$/i;

export interface DiscoverOptions {
  maxUrls?: number;
  timeLimitMs?: number;
  maxDepth?: number;
}

export interface DiscoveredPage {
  url: string;
  title: string;
  depth: number;
  lang?: string;
  hreflangs?: { href: string; hreflang: string }[];
}

export interface DiscoveryResult {
  source: 'sitemap' | 'crawl';
  pages: DiscoveredPage[];
  capped: false | 'urls' | 'time';
  favicon: string;
  rootLang?: string;
  rootAlternates?: { href: string; hreflang: string }[];
  elapsedMs: number;
}

class Budget {
  readonly started = Date.now();
  constructor(public maxUrls: number, public timeLimitMs: number) {}
  get timeLeft() {
    return this.timeLimitMs - (Date.now() - this.started);
  }
  get expired() {
    return this.timeLeft <= 0;
  }
}

async function fetchText(url: string, budget: Budget): Promise<{ status: number; type: string; text: string; url: string } | null> {
  if (budget.expired) return null;
  try {
    const res = await safeFetch(url, { timeoutMs: Math.max(250, Math.min(10_000, budget.timeLeft)), maxBytes: 10 * 1024 * 1024 });
    let body = res.body;
    if (/\.gz($|\?)/.test(url) || body[0] === 0x1f) {
      try {
        body = gunzipSync(body);
      } catch {}
    }
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: body.toString('utf8'), url: res.url };
  } catch {
    return null;
  }
}

function keep(url: string, root: string): string | null {
  try {
    const norm = normaliseUrl(url);
    const u = new URL(norm);
    if (!sameSite(norm, root) || SKIP_EXT.test(u.pathname)) return null;
    return norm;
  } catch {
    return null;
  }
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = (block: string) => [...block.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].trim().replace(/&amp;/g, '&'));
  const sitemaps = [...xml.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi)].flatMap((m) => locs(m[0]));
  const urls = [...xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)].flatMap((m) => locs(m[0]));
  return { urls, sitemaps };
}

export function sitemapsFromRobots(robots: string, root: string): string[] {
  return [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => new URL(m[1], root).toString());
}

async function fromSitemaps(root: string, budget: Budget): Promise<{ urls: string[]; capped: boolean } | null> {
  const robots = await fetchText(new URL('/robots.txt', root).toString(), budget);
  const queue = robots && robots.status < 400 ? sitemapsFromRobots(robots.text, root) : [];
  if (!queue.length) queue.push(new URL('/sitemap.xml', root).toString(), new URL('/sitemap_index.xml', root).toString());
  const seenMaps = new Set<string>();
  const urls = new Set<string>();
  let foundAny = false;
  while (queue.length && seenMaps.size < 50 && !budget.expired) {
    const map = queue.shift()!;
    if (seenMaps.has(map)) continue;
    seenMaps.add(map);
    const res = await fetchText(map, budget);
    if (!res || res.status >= 400 || !/<(urlset|sitemapindex)\b/i.test(res.text)) continue;
    foundAny = true;
    const parsed = parseSitemap(res.text);
    queue.push(...parsed.sitemaps);
    for (const u of parsed.urls) {
      const k = keep(u, root);
      if (k) urls.add(k);
      if (urls.size >= budget.maxUrls) return { urls: [...urls], capped: true };
    }
  }
  return foundAny && urls.size ? { urls: [...urls], capped: false } : null;
}

/** Fetches titles for sitemap URLs while time allows; the rest get a title from their path. */
async function fillTitles(urls: string[], budget: Budget): Promise<DiscoveredPage[]> {
  const pages: DiscoveredPage[] = urls.map((url) => ({ url, title: '', depth: new URL(url).pathname === '/' ? 0 : 1 }));
  let next = 0;
  const work = async () => {
    while (next < pages.length && budget.timeLeft > 500) {
      const page = pages[next++];
      const res = await fetchText(page.url, budget);
      if (res && res.status < 400) {
        page.title = extractTitle(res.text);
        page.lang = htmlLang(res.text);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  for (const p of pages) p.title ||= titleFromPath(p.url);
  return pages;
}

async function crawl(root: string, homeHtml: string, budget: Budget, maxDepth: number): Promise<{ pages: DiscoveredPage[]; capped: false | 'urls' | 'time' }> {
  const found = new Map<string, DiscoveredPage>();
  found.set(root, { url: root, title: extractTitle(homeHtml) || 'Home', depth: 0, lang: htmlLang(homeHtml) });
  let frontier: { url: string; html: string }[] = [{ url: root, html: homeHtml }];
  let capped: false | 'urls' | 'time' = false;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const nextLevel: string[] = [];
    // Header/nav links first, then footer, then body (PD-3).
    for (const { url, html } of frontier) {
      const links = extractLinks(html, url).sort((a, b) => ['nav', 'footer', 'body'].indexOf(a.region) - ['nav', 'footer', 'body'].indexOf(b.region));
      for (const link of links) {
        const k = keep(link.href, root);
        if (!k || found.has(k)) continue;
        if (found.size >= budget.maxUrls) {
          capped = 'urls';
          break;
        }
        found.set(k, { url: k, title: '', depth });
        nextLevel.push(k);
      }
    }
    if (capped) break;
    frontier = [];
    // Fetch this level's pages: gives their titles and, below max depth, their links.
    let i = 0;
    const work = async () => {
      while (i < nextLevel.length) {
        if (budget.timeLeft <= 0) {
          capped = 'time';
          return;
        }
        const url = nextLevel[i++];
        const res = await fetchText(url, budget);
        if (!res || res.status >= 400 || !/html/i.test(res.type)) continue;
        const page = found.get(url)!;
        page.title = extractTitle(res.text);
        page.lang = htmlLang(res.text);
        if (depth < maxDepth) frontier.push({ url, html: res.text });
      }
    };
    await Promise.all(Array.from({ length: 8 }, work));
    if (capped) break;
  }
  const pages = [...found.values()];
  for (const p of pages) p.title ||= titleFromPath(p.url);
  return { pages, capped };
}

export async function discoverSite(rootUrl: string, opts: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const budget = new Budget(opts.maxUrls ?? DEFAULT_MAX_URLS, opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS);
  const root = normaliseUrl(rootUrl);
  const home = await fetchText(root, budget);
  const homeHtml = home && home.status < 400 ? home.text : '';
  const favicon = extractFavicon(homeHtml, root);
  const rootAlternates = extractAlternates(homeHtml, root);
  const result = (r: Omit<DiscoveryResult, 'favicon' | 'elapsedMs' | 'rootLang' | 'rootAlternates'>): DiscoveryResult => ({
    ...r,
    favicon,
    rootLang: htmlLang(homeHtml),
    rootAlternates,
    elapsedMs: Date.now() - budget.started,
  });

  const fromMaps = await fromSitemaps(root, budget);
  if (fromMaps) {
    const urls = fromMaps.urls.includes(root) ? fromMaps.urls : [root, ...fromMaps.urls].slice(0, budget.maxUrls);
    const pages = await fillTitles(urls, budget);
    const home = pages.find((p) => p.url === root);
    if (home && homeHtml) home.title = extractTitle(homeHtml) || home.title;
    return result({ source: 'sitemap', pages, capped: fromMaps.capped ? 'urls' : budget.expired ? 'time' : false });
  }
  const crawled = await crawl(root, homeHtml, budget, opts.maxDepth ?? 2);
  return result({ source: 'crawl', pages: crawled.pages, capped: crawled.capped || (budget.expired ? 'time' : false) });
}

/** Job handler: runs discovery for a project and stores the pages. */
export async function discoverProject(data: { projectId: string; userId?: string; options?: DiscoverOptions }) {
  const project = await one('SELECT * FROM projects WHERE id = $1', [data.projectId]);
  if (!project) throw new Error('project not found');
  await query("UPDATE projects SET discovery = $2 WHERE id = $1", [project.id, JSON.stringify({ status: 'running', startedAt: new Date() })]);
  try {
    const res = await discoverSite(project.root_url, data.options);
    await logDomain(data.userId ?? project.owner_id, project.root_url, 'discover', project.id);
    const groups = templateGroups(res.pages.map((p) => p.url));
    await upsertPages(
      project.id,
      res.pages.map((p) => ({
        url: p.url,
        title: p.title,
        favicon_url: res.favicon,
        template_group: groups.get(p.url) ?? null,
        lang: detectLanguage(p.url, res.rootAlternates, p.lang),
      })),
    );
    const summary = { status: 'done', source: res.source, found: res.pages.length, capped: res.capped, elapsedMs: res.elapsedMs, finishedAt: new Date() };
    await query('UPDATE projects SET discovery = $2 WHERE id = $1', [project.id, JSON.stringify(summary)]);
    return summary;
  } catch (err: any) {
    await query('UPDATE projects SET discovery = $2 WHERE id = $1', [project.id, JSON.stringify({ status: 'failed', error: String(err?.message ?? err) })]);
    throw err;
  }
}
