// SC-2: API keys for the public API. Only a hash is stored; the key is shown once.
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config';
import { one, query } from './db';
import { redis } from './queue';
import { findUser, type User } from './users';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

export async function createApiKey(userId: string, name: string, ratePerMinute = 60) {
  const key = `mk_${randomBytes(24).toString('base64url')}`;
  const row = (await one(
    'INSERT INTO api_keys(user_id, name, prefix, key_hash, rate_per_minute) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, prefix, rate_per_minute, created_at',
    [userId, name.slice(0, 80) || 'API key', key.slice(0, 10), hash(key), ratePerMinute],
  ))!;
  return { ...row, key };
}

export async function listApiKeys(userId: string) {
  return query('SELECT id, name, prefix, rate_per_minute, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  return (await query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id', [id, userId])).length > 0;
}

export class ApiKeyError extends Error {
  constructor(public statusCode: number, message: string, public code: string, public retryAfterSeconds?: number) {
    super(message);
  }
}

/** Resolves a key to its user and applies the key's per-minute rate limit. */
export async function authenticateApiKey(key: string | undefined, now = Date.now()): Promise<{ user: User; keyId: string }> {
  if (!key?.startsWith('mk_')) throw new ApiKeyError(401, 'Send an API key as "Authorization: Bearer mk_..."', 'api_key_required');
  const row = await one('SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL', [hash(key)]);
  if (!row) throw new ApiKeyError(401, 'This API key is not valid', 'bad_api_key');
  const minute = Math.floor(now / 60_000);
  const bucket = `${config.queuePrefix}:apirate:${row.id}:${minute}`;
  const used = await redis().incr(bucket);
  if (used === 1) await redis().expire(bucket, 120);
  if (used > row.rate_per_minute) throw new ApiKeyError(429, 'Too many requests for this API key', 'rate_limited', 60 - Math.floor((now / 1000) % 60));
  await query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.id]);
  const user = await findUser(row.user_id);
  if (!user) throw new ApiKeyError(401, 'This API key is not valid', 'bad_api_key');
  return { user, keyId: row.id };
}
