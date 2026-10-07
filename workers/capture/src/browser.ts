import { chromium, type Browser } from 'playwright';

let browser: Promise<Browser> | undefined;

/** One Chromium per worker process; every capture gets its own fresh context (NF-ISO). */
export function getBrowser(): Promise<Browser> {
  if (!browser) {
    const args = ['--disable-dev-shm-usage', '--no-default-browser-check', '--disable-features=Translate,MediaRouter', '--font-render-hinting=none'];
    // Test only: map *.fixture.test to the local fixture server.
    const fixtures = process.env.FIXTURE_HOSTS?.split(',').map((e) => e.split('=')).map(([s, ip]) => `MAP *.${s} ${ip}`);
    if (fixtures?.length) args.push(`--host-resolver-rules=${fixtures.join(',')}`);
    browser = chromium.launch({ args, executablePath: process.env.CHROMIUM_PATH || undefined }).then((b) => {
      b.on('disconnected', () => (browser = undefined));
      return b;
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) await (await browser).close().catch(() => {});
  browser = undefined;
}
