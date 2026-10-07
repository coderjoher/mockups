import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normaliseUrl } from '../src/url';
import { assertPublicUrl, isPrivateIp, safeFetch, setResolver } from '../src/ssrf';
import { consumePages, logDomain } from '../src/ratelimit';
import { closePool, query } from '../src/db';
import { closeQueues } from '../src/queue';
import { extractFavicon, extractLinks, extractTitle } from '../src/html';
import { startFixtures } from '../../../tests/setup/fixtures';
import { makeUser, resetDb, resetRedis } from '../../../tests/setup/helpers';

let fx: Awaited<ReturnType<typeof startFixtures>>;
beforeAll(async () => {
  fx = await startFixtures();
});
afterAll(async () => {
  fx.server.close();
  await closeQueues();
  await closePool();
});

describe('[PD-1] URL normalisation', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['  EXAMPLE.com/About  ', 'https://example.com/About'],
    ['http://example.com', 'http://example.com/'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['https://example.com/p?utm_source=x&utm_medium=y&id=5&fbclid=abc&gclid=1', 'https://example.com/p?id=5'],
    ['https://example.com/p?ref=home#section', 'https://example.com/p?ref=home'],
    ['https://user:pass@example.com/', 'https://example.com/'],
    ['https://مثال.com/صفحة', 'https://xn--mgbh0fb.com/%D8%B5%D9%81%D8%AD%D8%A9'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseUrl(input)).toBe(expected);
  });

  it.each(['', 'not a url', 'file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.c'])('rejects %j', (input) => {
    expect(() => normaliseUrl(input)).toThrow();
  });
});

describe('[NF-SSRF] private address guard', () => {
  it.each([
    '127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '224.0.0.1',
  ])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111'])('%s is public', (ip) => expect(isPrivateIp(ip)).toBe(false));

  it.each([
    'http://localhost/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://017700000001/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://foo.localhost/', 'http://10.0.0.5:6379/',
  ])('blocks %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toMatchObject({ code: 'blocked_url' });
  });

  it('blocks a hostname whose DNS answer is private', async () => {
    const restore = setResolver(async () => ['93.184.216.34', '127.0.0.1']);
    try {
      await expect(assertPublicUrl('https://rebind.example/')).rejects.toMatchObject({ code: 'blocked_url' });
    } finally {
      restore();
    }
  });

  it('re-checks the address at connect time (DNS rebinding)', async () => {
    let calls = 0;
    const restore = setResolver(async () => (++calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']));
    try {
      await expect(safeFetch('http://rebind.example/')).rejects.toMatchObject({ code: 'blocked_url' });
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      restore();
    }
  });

  it('blocks redirects to internal addresses and non-http schemes, follows safe ones', async () => {
    await expect(safeFetch(fx.url('redirects', '/to-metadata'))).rejects.toMatchObject({ code: 'blocked_url' });
    await expect(safeFetch(fx.url('redirects', '/to-loopback'))).rejects.toMatchObject({ code: 'blocked_url' });
    await expect(safeFetch(fx.url('redirects', '/to-file'))).rejects.toMatchObject({ code: 'blocked_url' });
    await expect(safeFetch(fx.url('redirects', '/loop'))).rejects.toMatchObject({ code: 'too_many_redirects' });
    const ok = await safeFetch(fx.url('redirects', '/to-ok'));
    expect(ok.status).toBe(200);
    expect(ok.url).toBe(fx.url('redirects', '/final'));
    expect(ok.redirects).toEqual([fx.url('redirects', '/final')]);
  });
});

describe('[NF-RATE] per-user hourly page limit', () => {
  beforeEach(async () => {
    await resetDb();
    await resetRedis();
  });

  it('allows 50 pages an hour, refuses the 51st, and does not affect other users', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) await consumePages('user-a', 10, now);
    await expect(consumePages('user-a', 1, now)).rejects.toMatchObject({ statusCode: 429 });
    await expect(consumePages('user-b', 50, now)).resolves.toEqual({ remaining: 0 });
    // An hour later the window has slid.
    await expect(consumePages('user-a', 1, now + 3600_001)).resolves.toEqual({ remaining: 49 });
  });

  it('logs every domain', async () => {
    const u = await makeUser();
    await logDomain(u.id, 'https://shop.example.com/a', 'capture');
    const rows = await query('SELECT domain, kind FROM domain_log');
    expect(rows).toEqual([{ domain: 'shop.example.com', kind: 'capture' }]);
  });
});

describe('html helpers', () => {
  it('extracts title, favicon and links by region', () => {
    const html = `<html><head><title> A &amp; B </title><link rel="shortcut icon" href="/f.png"></head>
      <body><header><a href="/about">About</a></header><nav><a href='/blog'>Blog</a></nav>
      <main><a href="https://other.com/x">x</a><a href="mailto:a@b">m</a><a href="#top">t</a><a href=/products>P</a></main>
      <!-- <a href="/hidden"> --><footer><a href="/contact">C</a></footer></body></html>`;
    expect(extractTitle(html)).toBe('A & B');
    expect(extractFavicon(html, 'https://s.com/x/')).toBe('https://s.com/f.png');
    expect(extractFavicon('<p>', 'https://s.com/x/')).toBe('https://s.com/favicon.ico');
    expect(extractLinks(html, 'https://s.com/').map((l) => `${l.region}:${l.href}`)).toEqual([
      'nav:https://s.com/about', 'nav:https://s.com/blog', 'body:https://other.com/x', 'body:https://s.com/products', 'footer:https://s.com/contact',
    ]);
  });
});
