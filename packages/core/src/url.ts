// PD-1: URL normalisation.
const TRACKING = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^dclid$/i, /^gbraid$/i, /^wbraid$/i, /^msclkid$/i, /^yclid$/i, /^igshid$/i, /^mc_cid$/i, /^mc_eid$/i, /^_ga$/i, /^_gl$/i, /^_hsenc$/i, /^_hsmi$/i, /^mkt_tok$/i, /^ref_src$/i];

export class UrlError extends Error {
  constructor(message: string, public code = 'invalid_url') {
    super(message);
  }
}

export function normaliseUrl(input: string, base?: string): string {
  let raw = (input ?? '').trim();
  if (!raw) throw new UrlError('Enter a website address');
  if (!base && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  if (!base && /^[a-z0-9.-]+:\d+/i.test(input.trim())) raw = `https://${input.trim()}`; // "example.com:8080"
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new UrlError('That does not look like a website address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UrlError('Only http and https links are supported', 'bad_scheme');
  if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.includes(':'))) {
    throw new UrlError('That does not look like a website address');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
  return url.toString();
}

export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.replace(/^www\./, '');
  return strip(new URL(a).hostname) === strip(new URL(b).hostname);
}

export function pathOf(url: string): string {
  const u = new URL(url);
  return decodeURIComponent(u.pathname) + u.search;
}
