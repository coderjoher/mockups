import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), 32);
  const expected = Buffer.from(hash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const SESSION_TTL = 14 * 24 * 3600;

export function signSession(userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_TTL;
  const body = `${userId}.${exp}`;
  return `${body}.${createHmac('sha256', config.secret).update(body).digest('base64url')}`;
}

export function verifySession(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [userId, exp, sig] = token.split('.');
  if (!userId || !exp || !sig) return null;
  const expected = createHmac('sha256', config.secret).update(`${userId}.${exp}`).digest('base64url');
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (Number(exp) * 1000 < now) return null;
  return userId;
}
