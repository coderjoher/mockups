// NF-RATE: sliding one-hour window of page loads per user, stored in Redis.
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { query } from './db';
import { redis } from './queue';

export const pagesPerHour = () => Number(process.env.RATE_LIMIT_PAGES_PER_HOUR ?? 50);
const WINDOW_MS = 3600_000;

export class RateLimitError extends Error {
  code = 'rate_limited';
  statusCode = 429;
  constructor(public retryAfterSeconds: number) {
    super(`Hourly page limit reached. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`);
  }
}

/** Reserves `pages` page loads for the user or throws RateLimitError without reserving anything. */
export async function consumePages(userId: string, pages: number, now = Date.now()): Promise<{ remaining: number }> {
  const key = `${config.queuePrefix}:rate:${userId}`;
  const r = redis();
  await r.zremrangebyscore(key, 0, now - WINDOW_MS);
  const used = await r.zcard(key);
  const limit = pagesPerHour();
  if (used + pages > limit) {
    const oldest = await r.zrangebyscore(key, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1);
    const retry = oldest.length ? (Number(oldest[1]) + WINDOW_MS - now) / 1000 : 3600;
    throw new RateLimitError(Math.max(1, retry));
  }
  const members: (string | number)[] = [];
  for (let i = 0; i < pages; i++) members.push(now, `${now}-${randomUUID()}`);
  if (members.length) await r.zadd(key, ...members);
  await r.pexpire(key, WINDOW_MS);
  return { remaining: limit - used - pages };
}

export async function logDomain(userId: string | null, url: string, kind: 'check' | 'discover' | 'capture', projectId: string | null = null) {
  await query('INSERT INTO domain_log(user_id, project_id, domain, url, kind) VALUES ($1,$2,$3,$4,$5)', [userId, projectId, new URL(url).hostname, url, kind]);
}
