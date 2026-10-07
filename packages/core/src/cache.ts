// CE-12: reuse a capture of the same URL, viewport and options taken in the last 24 hours.
import { createHash } from 'node:crypto';
import { one } from './db';
import { getStorage } from './storage';

export const CACHE_HOURS = 24;

export function captureCacheKey(url: string, device: string, mode: string, viewport: unknown, options: Record<string, unknown>): string {
  const stable = (o: any): any => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, stable(o[k])])) : o);
  return createHash('sha256').update(JSON.stringify([url, device, mode, stable(viewport), stable(options ?? {})])).digest('hex');
}

export async function findCached(key: string, excludeId: string): Promise<{ image_key: string; width: number; height: number; brand_colors: string[] } | undefined> {
  const hit = await one(
    `SELECT c.image_key, c.width, c.height, pr.brand_colors FROM captures c JOIN pages p ON p.id = c.page_id JOIN projects pr ON pr.id = p.project_id
      WHERE c.cache_key = $1 AND c.id <> $2 AND c.status = 'done' AND c.source = 'auto' AND c.image_key IS NOT NULL
        AND c.updated_at > now() - make_interval(hours => $3)
      ORDER BY c.updated_at DESC LIMIT 1`,
    [key, excludeId, CACHE_HOURS],
  );
  if (!hit || !(await getStorage().exists(hit.image_key))) return undefined;
  return hit;
}
