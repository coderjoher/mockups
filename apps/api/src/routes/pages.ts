import type { FastifyInstance } from 'fastify';
import { query } from '@mockups/core/db';
import { extractTitle } from '@mockups/core/html';
import { getProject } from '@mockups/core/projects';
import { listPages, setSelected, titleFromPath, upsertPages } from '@mockups/core/pages';
import { enqueue } from '@mockups/core/queue';
import { safeFetch } from '@mockups/core/ssrf';
import { normaliseUrl, UrlError } from '@mockups/core/url';
import { HttpError, requireUser } from '../app';

export async function startDiscovery(projectId: string, userId: string, options?: Record<string, unknown>) {
  await query('UPDATE projects SET discovery = $2 WHERE id = $1', [projectId, JSON.stringify({ status: 'queued' })]);
  return enqueue('discover', { projectId, userId, options }, projectId);
}

export async function pageRoutes(app: FastifyInstance) {
  const load = async (req: any) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    return project;
  };

  app.post<{ Params: { id: string } }>('/projects/:id/discover', async (req) => {
    const project = await load(req);
    // Test hook: E2E runs may shorten the caps; ignored in production.
    const options = process.env.E2E ? (req.body as any)?.options : undefined;
    return { jobId: await startDiscovery(project.id, req.user!.id, options) };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string; lang?: string } }>('/projects/:id/pages', async (req) => {
    const project = await load(req);
    return { discovery: project.discovery, pages: await listPages(project.id, req.query.q, req.query.lang) };
  });

  // PD-7: add a page by hand. It goes through the same normalisation and SSRF guard.
  app.post<{ Params: { id: string }; Body: { url?: string } }>('/projects/:id/pages', async (req, reply) => {
    const project = await load(req);
    let url: string;
    let title: string;
    try {
      url = normaliseUrl(req.body?.url ?? '', /^https?:\/\//i.test(req.body?.url ?? '') ? undefined : project.root_url);
      const res = await safeFetch(url, { timeoutMs: 15_000 });
      if (res.status >= 400) throw new UrlError(`The page did not load (HTTP ${res.status})`, 'unreachable');
      title = extractTitle(res.body.toString('utf8')) || titleFromPath(url);
    } catch (err) {
      if (err instanceof UrlError) throw new HttpError(422, err.message, err.code);
      throw err;
    }
    await upsertPages(project.id, [{ url, title, source: 'manual' }]);
    const [page] = await query('SELECT * FROM pages WHERE project_id = $1 AND url = $2', [project.id, url]);
    return reply.status(201).send({ page });
  });

  // PD-9: selection is capped at 20 pages.
  app.patch<{ Params: { id: string }; Body: { pageIds?: string[]; selected?: boolean } }>('/projects/:id/pages', async (req) => {
    const project = await load(req);
    const { pageIds = [], selected = true } = req.body ?? {};
    if (!Array.isArray(pageIds) || pageIds.some((p) => !/^[0-9a-f-]{36}$/i.test(p))) throw new HttpError(400, 'pageIds must be page ids');
    await setSelected(project.id, pageIds, selected);
    return { pages: await listPages(project.id) };
  });
}
