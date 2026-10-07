import type { Job } from 'bullmq';
import { scheduleCaptures } from '@mockups/core/captures';
import { one, query } from '@mockups/core/db';
import { logDomain } from '@mockups/core/ratelimit';
import { getStorage } from '@mockups/core/storage';
import { viewportsFor } from '@mockups/core/viewports';
import { capturePage, explain } from './capture';
import { captureCacheKey, findCached } from '@mockups/core/cache';

/** Captures every pending device of one page. Failures are stored per capture so one bad device or page never blocks the rest. */
export async function captureJob(data: { jobId: string; projectId: string; pageId: string }, job?: Job) {
  const final = !job || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  let willRetry = false;
  try {
    const page = await one(
      `SELECT p.*, pr.viewports, pr.owner_id, pr.brand_colors FROM pages p JOIN projects pr ON pr.id = p.project_id WHERE p.id = $1`,
      [data.pageId],
    );
    if (!page) return { skipped: 'page deleted' };
    const viewports = viewportsFor(page.viewports);
    const captures = await query("SELECT * FROM captures WHERE page_id = $1 AND job_id = $2 AND status <> 'done' ORDER BY device", [data.pageId, data.jobId]);
    let failed = 0;
    for (const c of captures) {
      await query("UPDATE captures SET status = 'running', error = NULL, updated_at = now() WHERE id = $1", [c.id]);
      const viewport = viewports[c.device as keyof typeof viewports];
      const cacheKey = captureCacheKey(page.url, c.device, c.mode, viewport, c.options);
      const isHome = page.order === 0 && c.device === 'desktop';
      try {
        // CE-12: a capture of the same URL, viewport and options from the last 24 h is copied, not re-shot.
        const hit = await findCached(cacheKey, c.id);
        if (hit) {
          if (isHome && hit.brand_colors?.length && !page.brand_colors?.length) {
            await query('UPDATE projects SET brand_colors = $2 WHERE id = $1', [data.projectId, JSON.stringify(hit.brand_colors)]);
          }
          const key = `captures/${data.projectId}/${data.pageId}/${c.device}-${c.mode}-${Date.now()}.png`;
          await getStorage().put(key, await getStorage().get(hit.image_key), 'image/png');
          await query(
            "UPDATE captures SET status = 'done', width = $2, height = $3, image_key = $4, cache_key = $5, source = 'auto', updated_at = now() WHERE id = $1",
            [c.id, hit.width, hit.height, key, cacheKey],
          );
          continue;
        }
        const res = await capturePage(page.url, c.device, viewport, { ...c.options, mode: c.mode, brandColours: isHome });
        if (res.brandColours?.length) await query('UPDATE projects SET brand_colors = $2 WHERE id = $1', [data.projectId, JSON.stringify(res.brandColours)]);
        const key = `captures/${data.projectId}/${data.pageId}/${c.device}-${c.mode}-${Date.now()}.png`;
        await getStorage().put(key, res.png, 'image/png');
        if (c.image_key && c.image_key !== key) await getStorage().delete(c.image_key).catch(() => {});
        await query(
          "UPDATE captures SET status = 'done', width = $2, height = $3, image_key = $4, cache_key = $5, source = 'auto', updated_at = now() WHERE id = $1",
          [c.id, res.width, res.height, key, cacheKey],
        );
        if (!page.title || page.title === 'Home') await query('UPDATE pages SET title = $2 WHERE id = $1 AND $2 <> \'\'', [page.id, res.title]);
      } catch (err) {
        failed++;
        await query("UPDATE captures SET status = $2, error = $3, updated_at = now() WHERE id = $1", [c.id, final ? 'failed' : 'queued', explain(err).message]);
      }
    }
    await logDomain(page.owner_id, page.url, 'capture', data.projectId);
    if (failed && !final) {
      willRetry = true;
      throw new Error(`${failed} capture(s) failed; retrying`);
    }
    return { captured: captures.length - failed, failed };
  } finally {
    // This page is finished (or gave up): hand its slot to the next waiting page.
    if (!willRetry) await scheduleCaptures(data.projectId, data.jobId).catch(() => {});
  }
}
