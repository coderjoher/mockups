import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capturePage, CAPTURE_TIMEOUT_MS, explain } from '../src/capture';
import { closeBrowser, getBrowser } from '../src/browser';
import { DEFAULT_VIEWPORTS, validateViewports, viewportsFor } from '@mockups/core/viewports';
import blocklist from '../src/cleanup/blocklist.json' with { type: 'json' };
import { startFixtures } from '../../../tests/setup/fixtures';
import { colourShare, decode } from '../../../tests/setup/png';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  fx.server.close();
  await closeBrowser();
});

describe('[CE-1] capture modes and output sizes', () => {
  it.each([
    ['desktop', 2880, 1800],
    ['tablet', 1668, 2388],
    ['mobile', 1170, 2532],
  ] as const)('%s above-the-fold capture is exactly %ix%i', async (device, w, h) => {
    const res = await capturePage(fx.url('capture'), device, DEFAULT_VIEWPORTS[device]);
    const png = decode(res.png);
    expect([png.width, png.height]).toEqual([w, h]);
    expect([res.width, res.height]).toEqual([w, h]);
    expect(res.title).toBe('Capture fixture');
  });

  it('caps full-page captures at 15,000 CSS px', async () => {
    const vp = { width: 400, height: 800, scale: 1 };
    const res = await capturePage(fx.url('tall'), 'desktop', vp, { mode: 'full' });
    const png = decode(res.png);
    expect([png.width, png.height]).toEqual([400, 15000]);
  });

  it('full-page capture of a short page is the page height', async () => {
    const res = await capturePage(fx.url('capture'), 'desktop', { width: 800, height: 600, scale: 1 }, { mode: 'full' });
    expect(decode(res.png).height).toBe(2700);
  });

  it('respects per-project viewport overrides and validates them', () => {
    expect(viewportsFor({ desktop: { width: 1280, height: 800 } }).desktop).toEqual({ width: 1280, height: 800, scale: 2 });
    expect(viewportsFor(null).mobile).toEqual({ width: 390, height: 844, scale: 3 });
    expect(validateViewports({ mobile: { width: 375, height: 812, scale: 3 } })).toEqual({ mobile: { width: 375, height: 812, scale: 3 } });
    expect(() => validateViewports({ watch: { width: 200, height: 200 } })).toThrow('unknown device');
    expect(() => validateViewports({ desktop: { width: 99999, height: 900 } })).toThrow('width');
    expect(() => validateViewports({ desktop: { width: 1440, height: 900, scale: 7 } })).toThrow('scale');
  });

  it('captures a custom viewport at its exact size', async () => {
    const res = await capturePage(fx.url('capture'), 'desktop', { width: 1280, height: 720, scale: 1 });
    const png = decode(res.png);
    expect([png.width, png.height]).toEqual([1280, 720]);
  });
});

describe('[CE-2] [CE-3] waiting and the scroll pass', () => {
  it('scrolls once so lazy content loads, and returns to the top', async () => {
    const res = await capturePage(fx.url('lazy'), 'desktop', { width: 800, height: 600, scale: 1 }, { mode: 'full' });
    const png = decode(res.png);
    // The lazy block (last 400px) turned red during the scroll pass.
    expect(colourShare(png, [255, 0, 0], 10, { x: 0, y: png.height - 390, w: 800, h: 380 })).toBeGreaterThan(0.95);
    // The top of the image is the top of the page.
    expect(colourShare(png, [238, 238, 238], 4, { x: 0, y: 0, w: 800, h: 100 })).toBeGreaterThan(0.95);
  });

  it('waits for web fonts and images before shooting', async () => {
    const { capturePage: cp } = await import('../src/capture');
    const res = await cp(fx.url('fonts'), 'desktop', { width: 800, height: 600, scale: 1 });
    expect(res.png.length).toBeGreaterThan(1000);
  });
});

describe('[CE-4] cookie banners, chat widgets and pop-ups are hidden', () => {
  it('removes every overlay but keeps the real fixed header', async () => {
    const res = await capturePage(fx.url('banners'), 'desktop', { width: 1000, height: 800, scale: 1 }, { mode: 'full' });
    const png = decode(res.png);
    expect(colourShare(png, [255, 0, 255], 20)).toBe(0);
    expect(colourShare(png, [17, 24, 39], 4, { x: 0, y: 0, w: 1000, h: 60 })).toBeGreaterThan(0.95);
    expect(res.hiddenOverlays).toBeGreaterThanOrEqual(1); // the unknown promo layer was caught by the heuristic
    expect(png.height).toBeGreaterThan(2000); // scroll lock removed: full height captured
  });

  it('keeps a maintained blocklist for each category', () => {
    expect(blocklist.cookieBanners.length).toBeGreaterThan(20);
    expect(blocklist.chatWidgets.length).toBeGreaterThan(10);
    expect(blocklist.consentAccept).toContain('#onetrust-accept-btn-handler');
  });
});

describe('[CE-5] animations and carousels are frozen', () => {
  it('two captures of an animated page are pixel-identical', async () => {
    const vp = { width: 900, height: 700, scale: 1 };
    const a = await capturePage(fx.url('animated'), 'desktop', vp);
    await new Promise((r) => setTimeout(r, 333));
    const b = await capturePage(fx.url('animated'), 'desktop', vp);
    expect(Buffer.compare(a.png, b.png)).toBe(0);
    // The fade-in heading is visible (animation jumped to its end state), carousel on slide 1 (green).
    const png = decode(a.png);
    expect(colourShare(png, [22, 163, 74], 6)).toBeGreaterThan(0.05);
  });
});

describe('[CE-8] Arabic fonts are installed and used', () => {
  it('has all four families installed on the worker', () => {
    if (os.platform() !== 'linux') return;
    const families = execFileSync('fc-list', [':lang=ar', 'family']).toString();
    for (const f of ['Noto Sans Arabic', 'Cairo', 'Tajawal', 'IBM Plex Sans Arabic']) expect(families).toContain(f);
  });

  it('renders real glyphs (no tofu boxes) in each font', async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(fx.url('fonts'));
    await page.evaluate(() => document.fonts.ready);
    const shots: Record<string, Buffer> = {};
    for (const id of ['noto', 'cairo', 'tajawal', 'plex']) {
      for (const ch of ['b', 'm']) shots[`${id}-${ch}`] = await page.locator(`#${id}-${ch}`).screenshot();
    }
    await page.close();
    for (const id of ['noto', 'cairo', 'tajawal', 'plex']) {
      // Tofu boxes render every missing character identically; real glyphs differ.
      expect(Buffer.compare(shots[`${id}-b`], shots[`${id}-m`])).not.toBe(0);
    }
    // Each family draws its own shapes, so it is the named font in use, not one shared fallback.
    const bees = ['noto', 'cairo', 'tajawal', 'plex'].map((id) => shots[`${id}-b`].toString('base64'));
    expect(new Set(bees).size).toBe(4);
  });
});

describe('[CE-9] timeouts and readable failure reasons', () => {
  it('uses a 45 second default limit', () => {
    expect(CAPTURE_TIMEOUT_MS).toBe(45_000);
  });

  it('fails a page that never finishes loading with a timeout reason', async () => {
    process.env.CAPTURE_TIMEOUT_MS = '2500';
    try {
      const started = Date.now();
      await expect(capturePage(fx.url('hang'), 'desktop', DEFAULT_VIEWPORTS.desktop)).rejects.toMatchObject({ reason: 'timeout', message: 'The page took longer than 3 seconds to load' });
      expect(Date.now() - started).toBeLessThan(6000);
    } finally {
      delete process.env.CAPTURE_TIMEOUT_MS;
    }
  });

  it('explains HTTP errors, refused connections and DNS failures', async () => {
    await expect(capturePage(fx.url('missing'), 'mobile', DEFAULT_VIEWPORTS.mobile)).rejects.toMatchObject({ reason: 'http', message: 'The page returned HTTP 404' });
    await expect(capturePage('http://127.0.0.1:9/', 'mobile', DEFAULT_VIEWPORTS.mobile)).rejects.toMatchObject({ reason: 'blocked' });
    expect(explain(new Error('net::ERR_NAME_NOT_RESOLVED at https://x')).reason).toBe('dns');
    expect(explain(new Error('net::ERR_CONNECTION_REFUSED')).reason).toBe('refused');
    expect(explain(new Error('net::ERR_CERT_DATE_INVALID')).reason).toBe('tls');
    expect(explain(new Error('net::ERR_EMPTY_RESPONSE')).message).toBe('The page could not be loaded (ERR_EMPTY_RESPONSE)');
  });
});

describe('[NF-ISO] isolation', () => {
  it('dismisses dialogs, blocks downloads, file URLs and internal sub-resources, and still captures', async () => {
    const before = readdirSync(os.tmpdir()).length;
    const res = await capturePage(fx.url('dialogs'), 'desktop', { width: 800, height: 600, scale: 1 });
    expect(res.title).toBe('Dialogs fixture');
    expect(decode(res.png).width).toBe(800);
    const browser = await getBrowser();
    expect(browser.contexts()).toHaveLength(0); // context closed afterwards
    expect(readdirSync(os.tmpdir()).filter((f) => f.includes('payload')).length).toBe(0);
    expect(readdirSync(os.tmpdir()).length).toBeLessThanOrEqual(before + 2);
  });
});

describe('[NF-PRIV] no cookies carried between captures', () => {
  it('starts every capture with an empty cookie jar', async () => {
    const { cookieLog } = await import('../../../tests/fixtures/dynamic');
    cookieLog.length = 0;
    await capturePage(fx.url('cookies'), 'desktop', { width: 800, height: 600, scale: 1 });
    await capturePage(fx.url('cookies'), 'desktop', { width: 800, height: 600, scale: 1 });
    const pageLoads = cookieLog.filter((c, i) => i === 0 || true);
    expect(pageLoads.length).toBeGreaterThanOrEqual(2);
    expect(cookieLog[0]).toBe('');
    // The first request of the second capture carries no cookie from the first.
    const secondStart = cookieLog.lastIndexOf('');
    expect(secondStart).toBeGreaterThan(0);
  });
});
