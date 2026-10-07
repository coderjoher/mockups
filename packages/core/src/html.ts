// Tiny HTML helpers for titles, links and favicons (no DOM needed for discovery).
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : undefined;
}

export function extractFavicon(html: string, base: string): string {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase() ?? '';
    const href = attr(tag, 'href');
    if (href && /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) {
      try {
        return new URL(href, base).toString();
      } catch {}
    }
  }
  return new URL('/favicon.ico', base).toString();
}

export interface Link {
  href: string;
  region: 'nav' | 'footer' | 'body';
  hreflang?: string;
}

/** Links of a page, tagged by where they sit: <header>/<nav>, <footer> or the body. */
export function extractLinks(html: string, base: string): Link[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '');
  const regions: { start: number; end: number; region: Link['region'] }[] = [];
  for (const [tag, region] of [['header', 'nav'], ['nav', 'nav'], ['footer', 'footer']] as const) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
    for (const m of body.matchAll(re)) regions.push({ start: m.index!, end: m.index! + m[0].length, region });
  }
  const out: Link[] = [];
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, base).toString();
    } catch {
      continue;
    }
    const region = regions.find((r) => m.index! >= r.start && m.index! < r.end)?.region ?? 'body';
    out.push({ href: abs, region, hreflang: attr(m[0], 'hreflang') });
  }
  return out;
}

export function extractAlternates(html: string, base: string): { href: string; hreflang: string }[] {
  const out: { href: string; hreflang: string }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (attr(tag, 'rel')?.toLowerCase() !== 'alternate') continue;
    const href = attr(tag, 'href');
    const hreflang = attr(tag, 'hreflang');
    if (href && hreflang) {
      try {
        out.push({ href: new URL(href, base).toString(), hreflang: hreflang.toLowerCase() });
      } catch {}
    }
  }
  return out;
}

export function htmlLang(html: string): string | undefined {
  const m = html.match(/<html\b[^>]*>/i);
  return m ? attr(m[0], 'lang')?.toLowerCase() : undefined;
}
