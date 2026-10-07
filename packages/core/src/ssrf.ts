// NF-SSRF: only public http(s) destinations, checked after DNS resolution and on every redirect.
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch, type Response } from 'undici';
import { UrlError } from './url';

export class BlockedUrlError extends UrlError {
  constructor(message: string) {
    super(message, 'blocked_url');
  }
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32], ['100::', 64],
] as const) blocked.addSubnet(addr, prefix, 'ipv6');

export function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16);
      return blocked.check([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'), 'ipv4');
    }
    return blocked.check(lower, 'ipv6');
  }
  return true;
}

/**
 * Test-only: FIXTURE_HOSTS="fixture.test=127.0.0.1" makes *.fixture.test resolve to that IP and
 * bypass the private-IP check, so local fixture sites can be crawled. Never set in production.
 */
function fixtureIp(hostname: string): string | undefined {
  const spec = process.env.FIXTURE_HOSTS;
  if (!spec) return undefined;
  for (const entry of spec.split(',')) {
    const [suffix, ip] = entry.split('=');
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return ip;
  }
  return undefined;
}

type Resolver = (host: string) => Promise<string[]>;
let resolver: Resolver = async (host) => (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Swap the DNS resolver (tests). Returns a function that restores the previous one. */
export function setResolver(fn: Resolver): () => void {
  const prev = resolver;
  resolver = fn;
  return () => {
    resolver = prev;
  };
}

/** Resolves a hostname and throws if any address is private/internal. */
export async function resolvePublic(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const fixture = fixtureIp(host);
  if (fixture) return [fixture];
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new BlockedUrlError('Local and internal addresses are not allowed');
  }
  const addrs = net.isIP(host) ? [host] : await resolver(host).catch(() => {
    throw new UrlError(`Could not find the site ${host}`, 'dns_failed');
  });
  if (!addrs.length) throw new UrlError(`Could not find the site ${host}`, 'dns_failed');
  if (addrs.some(isPrivateIp)) throw new BlockedUrlError('Local and internal addresses are not allowed');
  return addrs;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlError('That does not look like a website address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Only http and https links are supported');
  await resolvePublic(url.hostname);
  return url;
}

// The connection itself re-checks the IP it is about to dial, so DNS rebinding between
// the check above and the connect cannot reach an internal address.
const agent = new Agent({
  connect: {
    lookup(hostname, _opts, cb) {
      resolvePublic(hostname).then(
        (addrs) => cb(null, addrs.map((address) => ({ address, family: net.isIP(address) })) as any),
        (err) => cb(err, '', 4),
      );
    },
  },
});

export interface SafeResponse {
  url: string;
  status: number;
  headers: Response['headers'];
  body: Buffer;
  redirects: string[];
}

export async function safeFetch(raw: string, opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; method?: string } = {}): Promise<SafeResponse> {
  const { timeoutMs = 15_000, maxBytes = 5 * 1024 * 1024, maxRedirects = 5 } = opts;
  const redirects: string[] = [];
  let current = raw;
  const deadline = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    const url = await assertPublicUrl(current);
    const res = await undiciFetch(url, {
      method: opts.method ?? 'GET',
      redirect: 'manual',
      dispatcher: agent,
      signal: deadline,
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 MockupGenerator',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }).catch((err: any) => {
      const cause = err?.cause ?? err;
      if (cause instanceof UrlError) throw cause;
      if (deadline.aborted) throw new UrlError('The site took too long to respond', 'timeout');
      throw new UrlError(`The site did not load (${cause?.code ?? cause?.message ?? 'network error'})`, 'unreachable');
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      if (hop >= maxRedirects) throw new UrlError('Too many redirects', 'too_many_redirects');
      current = new URL(res.headers.get('location')!, url).toString();
      redirects.push(current);
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > maxBytes) break;
        chunks.push(Buffer.from(chunk));
      }
    }
    return { url: url.toString(), status: res.status, headers: res.headers, body: Buffer.concat(chunks), redirects };
  }
}
