// NF-STOR: captures are deleted after 30 days unless the project is saved.
import { query } from './db';
import { getStorage } from './storage';

export const RETENTION_DAYS = 30;

export async function deleteExpiredCaptures(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600 * 1000);
  const rows = await query(
    `DELETE FROM captures c USING pages p, projects pr
      WHERE p.id = c.page_id AND pr.id = p.project_id AND NOT pr.saved AND c.updated_at < $1
      RETURNING c.image_key`,
    [cutoff],
  );
  for (const r of rows) if (r.image_key) await getStorage().delete(r.image_key).catch(() => {});
  return rows.length;
}
