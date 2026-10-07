// PD-6 template grouping and PD-8 language variants.

/**
 * Pages that share a path prefix and differ only in their last segment (e.g. /product/a, /product/b, ...) come from
 * one template. With `minSiblings` or more such pages, they form the group "/product/*".
 */
export function templateGroups(urls: string[], minSiblings = 3): Map<string, string> {
  const byParent = new Map<string, string[]>();
  for (const u of urls) {
    const segs = new URL(u).pathname.split('/').filter(Boolean);
    if (segs.length < 2) continue;
    const parent = '/' + segs.slice(0, -1).join('/') + '/*';
    byParent.set(parent, [...(byParent.get(parent) ?? []), u]);
  }
  const out = new Map<string, string>();
  for (const [group, members] of byParent) if (members.length >= minSiblings) for (const m of members) out.set(m, group);
  return out;
}

const LANG_PREFIX = /^\/(ar|en|fr|de|es|tr|ku|fa|ur)(?:[-_][a-z]{2})?(?:\/|$)/i;

/** PD-8: language from the URL prefix (/ar/, /en/), else from hreflang alternates, else from the page's <html lang>. */
export function detectLanguage(url: string, alternates: { href: string; hreflang: string }[] = [], htmlLang?: string): string | null {
  const m = new URL(url).pathname.match(LANG_PREFIX);
  if (m) return m[1].toLowerCase();
  const alt = alternates.find((a) => a.href === url && a.hreflang !== 'x-default');
  if (alt) return alt.hreflang.slice(0, 2).toLowerCase();
  return htmlLang ? htmlLang.slice(0, 2).toLowerCase() : null;
}
