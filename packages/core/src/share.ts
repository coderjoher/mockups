// EX-4: read-only, revocable gallery links.
import { randomBytes } from 'node:crypto';
import { one, query } from './db';
import { renderWithUrls } from './renders';

export async function createShareLink(projectId: string, userId: string) {
  const token = randomBytes(18).toString('base64url');
  return (await one('INSERT INTO share_links(token, project_id, created_by) VALUES ($1,$2,$3) RETURNING *', [token, projectId, userId]))!;
}

export async function listShareLinks(projectId: string) {
  return query('SELECT * FROM share_links WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
}

export async function revokeShareLink(id: string, workspaceId: string): Promise<boolean> {
  const rows = await query(
    `UPDATE share_links s SET revoked_at = now() FROM projects p
      WHERE s.id = $1 AND p.id = s.project_id AND p.workspace_id = $2 AND s.revoked_at IS NULL RETURNING s.id`,
    [id, workspaceId],
  );
  return rows.length > 0;
}

/** The public view: project title and its finished full-size renders. Nothing else is exposed. */
export async function sharedGallery(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return undefined;
  const link = await one(
    'SELECT s.*, p.title, p.root_url FROM share_links s JOIN projects p ON p.id = s.project_id WHERE s.token = $1 AND s.revoked_at IS NULL',
    [token],
  );
  if (!link) return undefined;
  // One item per mockup + page assignment (exports re-render the set, so keep the latest of each).
  const renders = await query(
    `SELECT * FROM (
       SELECT DISTINCT ON (layout, mockup_id, assignments::text) * FROM renders
        WHERE project_id = $1 AND status = 'done' AND NOT COALESCE((options->>'preview')::boolean, false)
        ORDER BY layout, mockup_id, assignments::text, created_at DESC
     ) latest ORDER BY created_at`,
    [link.project_id],
  );
  const items = await Promise.all(renders.map(renderWithUrls));
  return {
    title: link.title,
    site: link.root_url,
    renders: items.map((r) => ({ id: r.id, layout: r.layout, urls: r.urls, downloads: r.downloads })),
  };
}
