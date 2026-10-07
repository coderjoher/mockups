import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { discoverProject, discoverSite, parseSitemap, sitemapsFromRobots } from '../src/discover';
import { closePool, one, query } from '@mockups/core/db';
import { closeQueues } from '@mockups/core/queue';
import { startFixtures } from '../../../tests/setup/fixtures';
import { makeUser, resetDb } from '../../../tests/setup/helpers';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  fx.server.close();
  await closeQueues();
  await closePool();
});

const paths = (pages: { url: string }[]) => pages.map((p) => new URL(p.url).pathname + new URL(p.url).search).sort();

describe('[PD-2] robots.txt and sitemaps', () => {
  it('parses urlsets, sitemap indexes and robots Sitemap lines', () => {
    expect(parseSitemap('<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url><url><loc><![CDATA[https://a.com/y]]></loc></url></urlset>').urls).toEqual(['https://a.com/x?a=1&b=2', 'https://a.com/y']);
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>').sitemaps).toEqual(['https://a.com/s1.xml']);
    expect(sitemapsFromRobots('User-agent: *\nSITEMAP: /m.xml\nsitemap:https://a.com/n.xml', 'https://a.com/')).toEqual(['https://a.com/m.xml', 'https://a.com/n.xml']);
  });

  it('follows the Sitemap line in robots.txt and keeps same-site HTML pages only', async () => {
    const res = await discoverSite(fx.url('sitemap'));
    expect(res.source).toBe('sitemap');
    expect(res.capped).toBe(false);
    expect(paths(res.pages)).toEqual(['/', '/about', '/blog', '/contact', '/pricing', '/services']);
    expect(res.pages.find((p) => p.url.endsWith('/about'))!.title).toBe('About us');
    expect(res.favicon).toBe(fx.url('sitemap', '/favicon.png'));
  });

  it('reads a sitemap index, including a gzipped child sitemap', async () => {
    const res = await discoverSite(fx.url('sitemapindex'));
    expect(res.source).toBe('sitemap');
    expect(paths(res.pages)).toEqual(['/', '/a', '/b', '/post-1', '/post-2']);
  });
});

describe('[PD-3] crawling when there is no sitemap', () => {
  it('finds nav, footer and body links two levels deep on the same site only', async () => {
    const res = await discoverSite(fx.url('nositemap'));
    expect(res.source).toBe('crawl');
    expect(paths(res.pages)).toEqual(['/', '/about', '/blog', '/blog/post-1', '/contact', '/services', '/team']);
    expect(res.pages.find((p) => p.url.endsWith('/secret'))).toBeUndefined(); // level 3
    expect(res.pages.find((p) => p.url.includes('elsewhere'))).toBeUndefined();
    expect(res.pages.find((p) => p.url.endsWith('/team'))!.depth).toBe(2);
    // Nav links come before footer and body links.
    const order = res.pages.map((p) => new URL(p.url).pathname);
    expect(order.indexOf('/about')).toBeLessThan(order.indexOf('/blog'));
  });
});

describe('[PD-4] discovery caps', () => {
  it('stops at 200 URLs and reports a partial result', async () => {
    const res = await discoverSite(fx.url('huge'));
    expect(res.pages).toHaveLength(200);
    expect(res.capped).toBe('urls');
  });

  it('stops at the time limit and returns what it found', async () => {
    const started = Date.now();
    const res = await discoverSite(fx.url('slow'), { timeLimitMs: 1200 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.capped).toBe('time');
    expect(res.pages.length).toBeGreaterThan(1);
  });

  it('[P] discovers the 200-URL site in under 30 seconds', async () => {
    const res = await discoverSite(fx.url('huge'));
    expect(res.elapsedMs).toBeLessThan(30_000);
  });
});

describe('[PD-5] discovery job stores the checklist', () => {
  beforeEach(resetDb);

  it('saves pages with titles and favicon, keeps Home first and selected', async () => {
    const u = await makeUser();
    const project = await one("INSERT INTO projects(workspace_id, owner_id, root_url) VALUES ($1,$2,$3) RETURNING *", [u.workspace_id, u.id, fx.url('sitemap')]);
    await query('INSERT INTO pages(project_id, url, title, "order", selected) VALUES ($1,$2,$3,0,true)', [project.id, fx.url('sitemap'), 'Sitemap Co — Home']);
    const summary = await discoverProject({ projectId: project.id, userId: u.id });
    expect(summary).toMatchObject({ status: 'done', source: 'sitemap', found: 6, capped: false });
    const pages = await query('SELECT url, title, favicon_url, selected FROM pages WHERE project_id = $1 ORDER BY "order"', [project.id]);
    expect(pages).toHaveLength(6);
    expect(pages[0]).toMatchObject({ url: fx.url('sitemap'), selected: true, title: 'Sitemap Co — Home' });
    expect(pages.filter((p) => p.selected)).toHaveLength(1);
    expect(pages.every((p) => p.favicon_url === fx.url('sitemap', '/favicon.png'))).toBe(true);
    expect((await one('SELECT discovery FROM projects WHERE id = $1', [project.id])).discovery.status).toBe('done');
    expect((await one("SELECT count(*)::int AS n FROM domain_log WHERE kind = 'discover'")).n).toBe(1);
  });
});
