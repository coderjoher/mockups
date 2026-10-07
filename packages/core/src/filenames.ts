// EX-3: export file names, site_page_device_mockup.ext. Letters of any script (Arabic included) are kept.
export function slug(input: string, fallback = 'page'): string {
  const s = (input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || fallback;
}

export function siteName(url: string): string {
  return slug(new URL(url).hostname.replace(/^www\./, ''), 'site');
}

export function exportName(parts: { site: string; page: string; device: string; mockup: string; ext: string }): string {
  return `${slug(parts.site, 'site')}_${slug(parts.page)}_${slug(parts.device, 'device')}_${slug(parts.mockup, 'mockup')}.${parts.ext}`;
}

/** Makes names unique inside one ZIP: a.png, a-2.png, a-3.png. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    if (count === 1) return n;
    const dot = n.lastIndexOf('.');
    return `${n.slice(0, dot)}-${count}${n.slice(dot)}`;
  });
}
