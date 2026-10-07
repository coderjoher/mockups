// CX-3: the site's main colours, from its CSS (weighted by painted area) and its logo.

/** Runs in the page: area-weighted colours of headers, buttons, links and large blocks. Returns [hex, weight][]. */
export const BRAND_SCRIPT = `(() => {
  const out = {};
  const add = (c, w) => {
    const m = c && c.match(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return;
    const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    out[hex] = (out[hex] || 0) + w;
  };
  const vw = innerWidth, vh = Math.max(innerHeight, 1);
  for (const el of document.querySelectorAll('header, nav, footer, section, button, a, h1, h2, h3, [class*="btn"], [class*="button"], [class*="hero"]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.top > vh * 3) continue;
    const cs = getComputedStyle(el);
    const area = Math.min(r.width, vw) * Math.min(r.height, vh);
    const boost = /button|btn/i.test(el.className + el.tagName) ? 6 : 1;
    add(cs.backgroundColor, area * boost);
    if (/^(A|H1|H2|H3|BUTTON)$/.test(el.tagName)) add(cs.color, r.width * 20 * boost);
  }
  return Object.entries(out);
})()`;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Saturation/lightness filter: greys, near-white and near-black are not brand colours. */
export function isBrandish([r, g, b]: number[]): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return s > 0.25 && l > 0.12 && l < 0.92;
}

/** CIE76 colour difference in Lab space. */
export function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const lin = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
    });
    const [x, y, z] = [
      (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047,
      lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722,
      (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883,
    ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Merges weighted colours, drops non-brand ones, and returns up to `max` distinct colours (ΔE > 12 apart). */
export function pickBrandColours(weighted: [string, number][], max = 5): string[] {
  const sorted = weighted.filter(([hex]) => isBrandish(hexToRgb(hex))).sort((a, b) => b[1] - a[1]);
  const out: string[] = [];
  for (const [hex] of sorted) {
    if (out.every((o) => deltaE(o, hex) > 12)) out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}

/** Dominant saturated colours of an RGBA pixel buffer (the logo), weighted by pixel count. */
export function logoColours(data: Uint8Array | Buffer): [string, number][] {
  const buckets = new Map<string, { sum: number[]; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    if (!isBrandish(rgb)) continue;
    const key = rgb.map((v) => v >> 4).join(',');
    const b = buckets.get(key) ?? { sum: [0, 0, 0], n: 0 };
    b.sum = b.sum.map((s, k) => s + rgb[k]);
    b.n++;
    buckets.set(key, b);
  }
  return [...buckets.values()].map((b) => [rgbToHex(b.sum.map((s) => s / b.n)), b.n * 50] as [string, number]);
}
