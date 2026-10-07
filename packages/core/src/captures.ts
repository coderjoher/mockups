import { getPool, one, query } from './db';
import { consumePages } from './ratelimit';
import { enqueue } from './queue';
import { getStorage } from './storage';
import { DEVICES, type Device } from './viewports';

export const PAGES_IN_PARALLEL = 3; // CE-10
export const CAPTURE_ATTEMPTS = 2; // risk table: retry once, then offer upload

export interface CaptureRow {
  id: string;
  page_id: string;
  device: Device;
  mode: 'fold' | 'full';
  width: number | null;
  height: number | null;
  image_key: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  error: string | null;
  source: 'auto' | 'upload';
  job_id: string | null;
  options: Record<string, any>;
  updated_at: Date;
}

export interface CaptureRequest {
  mode?: 'fold' | 'full';
  devices?: Device[];
  pageIds?: string[];
  options?: Record<string, unknown>;
}

/** Queues captures for the selected pages (or the given pages) at the given devices. */
export async function requestCaptures(projectId: string, userId: string, req: CaptureRequest = {}): Promise<number> {
  const mode = req.mode === 'full' ? 'full' : 'fold';
  const devices = (req.devices?.length ? req.devices : DEVICES).filter((d) => DEVICES.includes(d));
  const pages = req.pageIds?.length
    ? await query('SELECT id FROM pages WHERE project_id = $1 AND id = ANY($2::uuid[])', [projectId, req.pageIds])
    : await query('SELECT id FROM pages WHERE project_id = $1 AND selected ORDER BY "order"', [projectId]);
  if (!pages.length) return 0;
  await consumePages(userId, pages.length); // NF-RATE counts pages
  for (const page of pages) {
    for (const device of devices) {
      await query(
        `INSERT INTO captures(page_id, device, mode, status, options) VALUES ($1,$2,$3,'queued',$4)
         ON CONFLICT (page_id, device, mode) DO UPDATE SET status = 'queued', error = NULL, job_id = NULL, source = 'auto',
           options = EXCLUDED.options, updated_at = now()`,
        [page.id, device, mode, JSON.stringify(req.options ?? {})],
      );
    }
  }
  await scheduleCaptures(projectId);
  return pages.length;
}

/** CE-10: keeps at most three pages of a project in flight; the rest wait in Postgres until a slot frees up. */
export async function scheduleCaptures(projectId: string, finishingJobId?: string): Promise<string[]> {
  const client = await getPool().connect();
  const started: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`captures:${projectId}`]);
    // A page is in flight while its job still has captures waiting or running. Counting captures (not job rows)
    // means jobs that are just finishing free their slot immediately.
    const { rows: [{ n }] } = await client.query(
      `SELECT count(DISTINCT c.job_id)::int AS n FROM captures c JOIN pages p ON p.id = c.page_id
        WHERE p.project_id = $1 AND c.job_id IS NOT NULL AND c.job_id IS DISTINCT FROM $2::uuid AND c.status IN ('queued','running')`,
      [projectId, finishingJobId ?? null],
    );
    const slots = PAGES_IN_PARALLEL - n;
    if (slots <= 0) return started;
    const { rows: pages } = await client.query(
      `SELECT p.id FROM pages p WHERE p.project_id = $1
         AND EXISTS (SELECT 1 FROM captures c WHERE c.page_id = p.id AND c.status = 'queued' AND c.job_id IS NULL)
       ORDER BY p."order" LIMIT $2`,
      [projectId, slots],
    );
    for (const { id: pageId } of pages) {
      const jobId = await enqueue('capture', { projectId, pageId }, projectId, {
        attempts: CAPTURE_ATTEMPTS,
        beforePush: async (id) => {
          await client.query("UPDATE captures SET job_id = $2 WHERE page_id = $1 AND status = 'queued' AND job_id IS NULL", [pageId, id]);
        },
      });
      started.push(jobId);
    }
    return started;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`captures:${projectId}`]).catch(() => {});
    client.release();
  }
}

export async function listCaptures(projectId: string): Promise<(CaptureRow & { url: string; title: string; image_url: string | null })[]> {
  const rows = await query(
    `SELECT c.*, p.url, p.title, p."order" AS page_order FROM captures c JOIN pages p ON p.id = c.page_id
      WHERE p.project_id = $1 ORDER BY p."order", c.mode, array_position(ARRAY['desktop','tablet','mobile'], c.device)`,
    [projectId],
  );
  const storage = getStorage();
  return Promise.all(rows.map(async (r) => ({ ...r, image_url: r.image_key && r.status === 'done' ? await storage.signedUrl(r.image_key) : null })));
}

export async function getCaptureForUser(captureId: string, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) return undefined;
  return one<CaptureRow & { project_id: string; url: string }>(
    `SELECT c.*, p.project_id, p.url FROM captures c JOIN pages p ON p.id = c.page_id JOIN projects pr ON pr.id = p.project_id
      WHERE c.id = $1 AND pr.workspace_id = $2`,
    [captureId, workspaceId],
  );
}
