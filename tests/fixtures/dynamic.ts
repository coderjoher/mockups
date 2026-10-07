import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> | boolean;

const html = (res: ServerResponse, body: string, status = 200) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  return true;
};
const redirect = (res: ServerResponse, to: string, status = 302) => {
  res.writeHead(status, { location: to }).end();
  return true;
};

const xml = (res: ServerResponse, body: string, gzip = false) => {
  res.writeHead(200, { 'content-type': gzip ? 'application/gzip' : 'application/xml' }).end(gzip ? gzipSync(body) : body);
  return true;
};
const urlset = (base: string, paths: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${p.startsWith('http') ? p : base + p}</loc></url>`).join('')}</urlset>`;
const page = (title: string, body = '') => `<!doctype html><html lang="en"><head><title>${title}</title><link rel="icon" href="/favicon.png"></head><body>${body}</body></html>`;
const origin = (req: IncomingMessage) => `http://${req.headers.host}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Generated responses per fixture site. */
export const dynamicRoutes: Record<string, Route> = {
  // Phase 1: redirects used by the SSRF tests.
  redirects(req, res, url) {
    if (url.pathname === '/to-metadata') return redirect(res, 'http://169.254.169.254/latest/meta-data/');
    if (url.pathname === '/to-loopback') return redirect(res, `http://127.0.0.1:${req.socket.localPort}/`);
    if (url.pathname === '/to-file') return redirect(res, 'file:///etc/passwd');
    if (url.pathname === '/to-ok') return redirect(res, '/final', 301);
    if (url.pathname === '/loop') return redirect(res, '/loop');
    if (url.pathname === '/final') return html(res, '<title>Final page</title><p>ok</p>');
    return false;
  },
  // Phase 2: discovery fixtures.
  sitemap(req, res, url) {
    const o = origin(req);
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow:\n\nSitemap: /maps/main.xml\n');
      return true;
    }
    if (url.pathname === '/maps/main.xml') {
      return xml(res, urlset(o, ['/', '/about', '/services', '/contact', '/pricing', '/blog', 'https://other.example/x', '/brochure.pdf', '/about?utm_source=news']));
    }
    if (url.pathname === '/sitemap.xml') return html(res, 'not here', 404);
    const titles: Record<string, string> = { '/': 'Sitemap Co — Home', '/about': 'About us', '/services': 'Services', '/contact': 'Contact', '/pricing': 'Pricing', '/blog': 'Blog' };
    return titles[url.pathname] ? html(res, page(titles[url.pathname])) : false;
  },
  sitemapindex(req, res, url) {
    const o = origin(req);
    if (url.pathname === '/sitemap.xml') {
      return xml(res, `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${o}/sitemap-pages.xml</loc></sitemap><sitemap><loc>${o}/sitemap-posts.xml.gz</loc></sitemap></sitemapindex>`);
    }
    if (url.pathname === '/sitemap-pages.xml') return xml(res, urlset(o, ['/', '/a', '/b']));
    if (url.pathname === '/sitemap-posts.xml.gz') return xml(res, urlset(o, ['/post-1', '/post-2']), true);
    if (url.pathname.endsWith('.xml') || url.pathname === '/robots.txt') return html(res, 'nope', 404);
    return html(res, page(`Index site ${url.pathname}`));
  },
  nositemap(_req, res, url) {
    const pages: Record<string, string> = {
      '/': page('No-sitemap home', `<header><nav><a href="/about">About</a><a href="/services">Services</a></nav></header>
        <main><a href="/blog">Blog</a><a href="http://elsewhere.fixture.test/">Partner</a><a href="/files/menu.pdf">Menu</a><a href="/about#team">Team</a></main>
        <footer><a href="/contact">Contact</a></footer>`),
      '/about': page('About', '<a href="/team">Team</a>'),
      '/team': page('Team', '<a href="/secret">Secret</a>'),
      '/secret': page('Secret'),
      '/services': page('Services'),
      '/blog': page('Blog', '<a href="/blog/post-1">Post</a>'),
      '/blog/post-1': page('First post'),
      '/contact': page('Contact'),
    };
    return pages[url.pathname] ? html(res, pages[url.pathname]) : html(res, 'nope', 404);
  },
  huge(req, res, url) {
    if (url.pathname === '/sitemap.xml') return xml(res, urlset(origin(req), Array.from({ length: 1000 }, (_, i) => `/item-${i}`)));
    if (url.pathname === '/robots.txt') return html(res, '', 404);
    return html(res, page(`Huge ${url.pathname}`));
  },
  async slow(_req, res, url) {
    if (url.pathname === '/') return html(res, page('Slow home', Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('')));
    if (/^\/p\d+$/.test(url.pathname)) {
      await sleep(1500);
      return html(res, page(`Slow ${url.pathname}`));
    }
    return html(res, 'nope', 404);
  },
  broken(_req, res, url) {
    if (url.pathname === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return true;
    }
    return html(res, '<h1>Server error</h1>', 500);
  },
};
