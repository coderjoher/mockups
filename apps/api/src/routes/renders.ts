import type { FastifyInstance } from 'fastify';
import { one, query } from '@mockups/core/db';
import { getProject } from '@mockups/core/projects';
import { createBatch, createLayoutRender, createRender, defaultAssignments, loadRenderInputs, RenderError, renderWithUrls } from '@mockups/core/renders';
import { createExport, exportStatus } from '@mockups/core/exports';
import { HttpError, requireUser } from '../app';

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export async function renderRoutes(app: FastifyInstance) {
  const load = async (req: any) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    return project;
  };

  // CR-2: what each screen would show by default.
  app.get<{ Params: { id: string }; Querystring: { mockupId?: string } }>('/projects/:id/assignments', async (req) => {
    const project = await load(req);
    if (!req.query.mockupId || !isId(req.query.mockupId)) throw new HttpError(400, 'mockupId is required');
    try {
      const { screens, captures } = await loadRenderInputs(project.id, req.query.mockupId);
      return { assignments: defaultAssignments(screens, captures) };
    } catch (err) {
      if (err instanceof RenderError) throw new HttpError(err.code === 'not_found' ? 404 : 422, err.message, err.code);
      throw err;
    }
  });

  app.post<{ Params: { id: string }; Body: { mockupId?: string; assignments?: unknown; preview?: boolean; formats?: string[] } }>('/projects/:id/renders', async (req, reply) => {
    const project = await load(req);
    const { mockupId = '', assignments, preview, formats } = req.body ?? {};
    if (!isId(mockupId)) throw new HttpError(400, 'mockupId is required');
    const fmts = (formats ?? ['png']).filter((f) => ['png', 'webp', 'jpg'].includes(f));
    try {
      const { render, jobId } = await createRender(project.id, mockupId, assignments, { preview, formats: fmts.length ? fmts : ['png'] });
      return reply.status(202).send({ render, jobId });
    } catch (err) {
      if (err instanceof RenderError) throw new HttpError(err.code === 'not_found' ? 404 : 422, err.message, err.code);
      throw err;
    }
  });

  // CR-4: one mockup for every captured page.
  app.post<{ Params: { id: string }; Body: { mockupId?: string; formats?: string[] } }>('/projects/:id/batch', async (req, reply) => {
    const project = await load(req);
    if (!isId(req.body?.mockupId ?? '')) throw new HttpError(400, 'mockupId is required');
    try {
      const formats = (req.body?.formats ?? ['png']).filter((f) => ['png', 'webp', 'jpg'].includes(f));
      return reply.status(202).send({ renders: await createBatch(project.id, req.body!.mockupId!, formats.length ? formats : ['png']) });
    } catch (err) {
      if (err instanceof RenderError) throw new HttpError(err.code === 'not_found' ? 404 : 422, err.message, err.code);
      throw err;
    }
  });

  // CR-5: photo-free layouts.
  app.post<{ Params: { id: string }; Body: { layout?: string; captureIds?: string[]; bg?: unknown; padding?: unknown; shadow?: unknown; preview?: boolean } }>('/projects/:id/layouts', async (req, reply) => {
    const project = await load(req);
    const { layout = '', captureIds = [], ...style } = req.body ?? {};
    try {
      return reply.status(202).send(await createLayoutRender(project.id, layout, (Array.isArray(captureIds) ? captureIds : []).filter(isId), style));
    } catch (err) {
      if (err instanceof RenderError) throw new HttpError(422, err.message, err.code);
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/projects/:id/renders', async (req) => {
    const project = await load(req);
    const rows = await query('SELECT * FROM renders WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100', [project.id]);
    return { renders: await Promise.all(rows.map(renderWithUrls)) };
  });

  // EX-3: ZIP of the whole set (or the given renders) in the chosen formats.
  app.post<{ Params: { id: string }; Body: { formats?: string[]; renderIds?: string[] } }>('/projects/:id/exports', async (req, reply) => {
    const project = await load(req);
    try {
      return reply.status(202).send(await createExport(project.id, req.body?.formats ?? ['png'], req.body?.renderIds?.filter(isId)));
    } catch (err) {
      if (err instanceof RenderError) throw new HttpError(422, err.message, err.code);
      throw err;
    }
  });

  app.get<{ Params: { id: string; jobId: string } }>('/projects/:id/exports/:jobId', async (req) => {
    const project = await load(req);
    const status = isId(req.params.jobId) ? await exportStatus(req.params.jobId, project.id) : undefined;
    if (!status) throw new HttpError(404, 'Export not found');
    return { ...status, url: status.url ? `${status.url}&dl=1` : null };
  });

  app.get<{ Params: { renderId: string } }>('/renders/:renderId', async (req) => {
    const user = await requireUser(req);
    const r = isId(req.params.renderId)
      ? await one('SELECT r.* FROM renders r JOIN projects p ON p.id = r.project_id WHERE r.id = $1 AND p.workspace_id = $2', [req.params.renderId, user.workspace_id])
      : undefined;
    if (!r) throw new HttpError(404, 'Render not found');
    return { render: await renderWithUrls(r) };
  });
}
