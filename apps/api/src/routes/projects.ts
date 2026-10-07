import type { FastifyInstance } from 'fastify';
import { query } from '@mockups/core/db';
import { createProject, getProject, listProjects } from '@mockups/core/projects';
import { consumePages } from '@mockups/core/ratelimit';
import { useQuota } from '@mockups/core/plans';
import { UrlError } from '@mockups/core/url';
import { HttpError, requireUser } from '../app';
import { startDiscovery } from './pages';

export async function projectRoutes(app: FastifyInstance) {
  app.post<{ Body: { url?: string } }>('/projects', async (req, reply) => {
    const user = await requireUser(req);
    await consumePages(user.id, 1);
    await useQuota(user.workspace_id, 'projects', 1);
    try {
      const project = await createProject(user, req.body?.url ?? '');
      const discoveryJobId = await startDiscovery(project.id, user.id);
      return reply.status(201).send({ project, discoveryJobId });
    } catch (err) {
      if (err instanceof UrlError) throw new HttpError(422, err.message, err.code);
      throw err;
    }
  });

  app.get('/projects', async (req) => ({ projects: await listProjects(await requireUser(req)) }));

  app.get<{ Params: { id: string } }>('/projects/:id', async (req) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    return { project };
  });

  app.patch<{ Params: { id: string }; Body: { title?: string; saved?: boolean; viewports?: Record<string, unknown> } }>('/projects/:id', async (req) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    const { title, saved } = req.body ?? {};
    const [updated] = await query('UPDATE projects SET title = COALESCE($2, title), saved = COALESCE($3, saved) WHERE id = $1 RETURNING *', [project.id, title ?? null, saved ?? null]);
    return { project: updated };
  });

  app.delete<{ Params: { id: string } }>('/projects/:id', async (req) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    await query('DELETE FROM projects WHERE id = $1', [project.id]);
    return { ok: true };
  });
}
