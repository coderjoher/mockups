// CE-1..CE-9: load a page in a fresh headless Chromium context, clean it up and screenshot it.
import type { BrowserContext, Page, Route } from 'playwright';
import { resolvePublic } from '@mockups/core/ssrf';
import { FULL_PAGE_MAX_CSS_PX, type Device, type Viewport } from '@mockups/core/viewports';
import blocklist from './cleanup/blocklist.json' with { type: 'json' };
import { FIX_STICKY, FREEZE_CSS, FREEZE_INIT, HIDE_GENERIC_OVERLAYS, hideCss, scrollScript, settleScript } from './cleanup/inject';
import { getBrowser } from './browser';
import { fitExact } from './fit';
import { BRAND_SCRIPT, logoColours, pickBrandColours } from '@mockups/core/brand';
import { PNG } from 'pngjs';

export const CAPTURE_TIMEOUT_MS = 45_000; // CE-9
export const captureTimeoutMs = () => Number(process.env.CAPTURE_TIMEOUT_MS ?? CAPTURE_TIMEOUT_MS);

const UA: Record<Device, string> = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  tablet: 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  mobile: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

export interface CaptureOptions {
  mode?: 'fold' | 'full';
  dark?: boolean;
  hideSelectors?: string[];
  delayMs?: number;
  fixStickyHeaders?: boolean;
  /** CX-3: also read the site's brand colours (used on the Home page). */
  brandColours?: boolean;
  /** SC-1: session cookies for this capture only (set on the page's own origin). */
  cookies?: { name: string; value: string }[];
}

export interface CaptureResult {
  png: Buffer;
  width: number;
  height: number;
  title: string;
  finalUrl: string;
  hiddenOverlays: number;
  brandColours?: string[];
}

export class CaptureError extends Error {
  constructor(message: string, public reason: string) {
    super(message);
  }
}

/** Turns Playwright/network errors into a sentence a non-developer understands (CE-9). */
export function explain(err: any): CaptureError {
  if (err instanceof CaptureError) return err;
  const msg = String(err?.message ?? err);
  if (/timeout|timed out/i.test(msg)) return new CaptureError(`The page took longer than ${Math.round(captureTimeoutMs() / 1000)} seconds to load`, 'timeout');
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) return new CaptureError('Could not find the site (DNS lookup failed)', 'dns');
  if (/ERR_BLOCKED_BY_CLIENT|blocked_url|not allowed/i.test(msg)) return new CaptureError('This address is not allowed (local or internal network)', 'blocked');
  if (/ERR_CONNECTION_REFUSED/.test(msg)) return new CaptureError('The site refused the connection', 'refused');
  if (/ERR_CERT|SSL/i.test(msg)) return new CaptureError("The site's security certificate is not valid", 'tls');
  const net = msg.match(/net::(ERR_[A-Z_]+)/);
  if (net) return new CaptureError(`The page could not be loaded (${net[1]})`, 'network');
  return new CaptureError(`The capture failed: ${msg.split('\n')[0].slice(0, 200)}`, 'error');
}

/** NF-SSRF inside the browser: every request (page, redirect, sub-resource, iframe) must go to a public http(s) host. */
function guardRequests(context: BrowserContext) {
  const verdicts = new Map<string, Promise<boolean>>();
  return context.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.abort('blockedbyclient');
    let ok = verdicts.get(url.hostname);
    if (!ok) {
      ok = resolvePublic(url.hostname).then(() => true, () => false);
      verdicts.set(url.hostname, ok);
    }
    return (await ok) ? route.continue() : route.abort('blockedbyclient');
  });
}

async function settle(page: Page, deadline: number) {
  const left = () => Math.max(0, deadline - Date.now());
  // CE-2: network idle (bounded: some sites never go idle), fonts and images.
  await page.waitForLoadState('networkidle', { timeout: Math.min(10_000, left()) }).catch(() => {});
  await page.evaluate(settleScript(Math.min(8_000, left()))).catch(() => {});
}

/** CE-3: scroll top to bottom once so lazy content and scroll animations load, then return to the top. */
async function scrollPass(page: Page, maxPx: number) {
  await page.evaluate(scrollScript(maxPx));
}

async function acceptConsent(page: Page) {
  for (const sel of blocklist.consentAccept) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 1000 }).catch(() => {});
      return;
    }
  }
}

export async function capturePage(url: string, device: Device, viewport: Viewport, opts: CaptureOptions = {}): Promise<CaptureResult> {
  const timeout = captureTimeoutMs();
  const deadline = Date.now() + timeout;
  const browser = await getBrowser();
  // NF-ISO / NF-PRIV: fresh context, no downloads, no stored cookies, nothing persisted afterwards.
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    isMobile: device !== 'desktop',
    hasTouch: device !== 'desktop',
    userAgent: UA[device],
    colorScheme: opts.dark ? 'dark' : 'light',
    acceptDownloads: false,
    serviceWorkers: 'block',
    locale: 'en-US',
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9,ar;q=0.8' },
  });
  // Hard kill: whatever happens, the context is closed at the deadline.
  let killed = false;
  const kill = setTimeout(() => {
    killed = true;
    context.close().catch(() => {});
  }, timeout + 1000);
  try {
    await guardRequests(context);
    if (opts.cookies?.length) await context.addCookies(opts.cookies.map((c) => ({ name: c.name, value: c.value, url: new URL(url).origin })));
    await context.addInitScript(FREEZE_INIT);
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('popup', (p) => p.close().catch(() => {}));
    const response = await page.goto(url, { waitUntil: 'load', timeout });
    if (response && response.status() >= 400) throw new CaptureError(`The page returned HTTP ${response.status()}`, 'http');
    await settle(page, deadline);
    await acceptConsent(page);
    const hide = [...blocklist.cookieBanners, ...blocklist.chatWidgets, ...blocklist.popups, ...(opts.hideSelectors ?? [])];
    await page.addStyleTag({ content: FREEZE_CSS + '\n' + hideCss(hide) });
    const maxPx = opts.mode === 'full' ? FULL_PAGE_MAX_CSS_PX : viewport.height;
    await scrollPass(page, opts.mode === 'full' ? FULL_PAGE_MAX_CSS_PX : Math.max(viewport.height * 4, 4000));
    await settle(page, deadline);
    if (opts.delayMs) await page.waitForTimeout(Math.min(opts.delayMs, 10_000));
    const hiddenOverlays = (await page.evaluate(HIDE_GENERIC_OVERLAYS)) as number;
    const brandColours = opts.brandColours ? await readBrandColours(page) : undefined;
    if (opts.mode === 'full' && opts.fixStickyHeaders !== false) await fixSticky(page);
    await page.evaluate('window.__mockupFreeze && window.__mockupFreeze()');
    let height = viewport.height;
    if (opts.mode === 'full') {
      const scrollHeight = (await page.evaluate('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)')) as number;
      height = Math.min(Math.max(scrollHeight, viewport.height), maxPx);
    }
    const shot = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      fullPage: opts.mode === 'full',
      clip: opts.mode === 'full' ? { x: 0, y: 0, width: viewport.width, height } : undefined,
      timeout: Math.max(5_000, deadline - Date.now()),
    });
    const png = fitExact(shot, viewport.width * viewport.scale, height * viewport.scale);
    return {
      png,
      width: viewport.width * viewport.scale,
      height: height * viewport.scale,
      title: await page.title(),
      finalUrl: page.url(),
      hiddenOverlays,
      brandColours,
    };
  } catch (err) {
    if (killed) throw new CaptureError(`The page took longer than ${Math.round(timeout / 1000)} seconds to load`, 'timeout');
    throw explain(err);
  } finally {
    clearTimeout(kill);
    await context.close().catch(() => {});
  }
}

/** CX-3: area-weighted CSS colours plus the dominant colours of the logo. */
async function readBrandColours(page: Page): Promise<string[]> {
  const weighted = ((await page.evaluate(BRAND_SCRIPT).catch(() => [])) as [string, number][]) ?? [];
  const logo = page.locator('header img, header svg, [class*="logo" i] img, img[alt*="logo" i], img[src*="logo" i], [id*="logo" i]').first();
  if (await logo.isVisible().catch(() => false)) {
    const shot = await logo.screenshot({ timeout: 3000, animations: 'disabled' }).catch(() => undefined);
    if (shot) weighted.push(...logoColours(PNG.sync.read(shot).data));
  }
  return pickBrandColours(weighted);
}

/** CE-6 (full-page mode): fixed/sticky headers would repeat down a stitched screenshot; pin them to the top once. */
async function fixSticky(page: Page) {
  await page.evaluate(FIX_STICKY);
}
