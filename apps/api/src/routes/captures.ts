import type { FastifyInstance } from 'fastify';
import { getCaptureForUser, listCaptures, requestCaptures, scheduleCaptures } from '@mockups/core/captures';
import { contentTypes, inspectImage } from '@mockups/core/images';
import { consumePages } from '@mockups/core/ratelimit';
import { getStorage } from '@mockups/core/storage';
import { query } from '@mockups/core/db';
import { getProject } from '@mockups/core/projects';
import { DEVICES, validateViewports, viewportsFor, type Device } from '@mockups/core/viewports';
import { HttpError, requireUser } from '../app';

export async function captureRoutes(app: FastifyInstance) {
  const load = async (req: any) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    return project;
  };

  app.post<{ Params: { id: string }; Body: { mode?: 'fold' | 'full'; devices?: Device[]; options?: Record<string, unknown> } }>('/projects/:id/captures', async (req, reply) => {
    const project = await load(req);
    const { mode, devices, options } = req.body ?? {};
    if (devices && (!Array.isArray(devices) || devices.some((d) => !DEVICES.includes(d)))) throw new HttpError(400, 'Unknown device');
    const pages = await requestCaptures(project.id, req.user!.id, { mode, devices, options: sanitiseOptions(options) });
    if (!pages) throw new HttpError(422, 'Select at least one page first', 'no_pages');
    return reply.status(202).send({ pages, captures: await listCaptures(project.id) });
  });

  app.get<{ Params: { id: string } }>('/projects/:id/captures', async (req) => {
    const project = await load(req);
    return { captures: await listCaptures(project.id), viewports: viewportsFor(project.viewports) };
  });

  // CE-11 / CE-9: retry a failed cell or recapture a done one. Only that page x device runs again.
  app.post<{ Params: { captureId: string } }>('/captures/:captureId/recapture', async (req) => {
    const user = await requireUser(req);
    const capture = await getCaptureForUser(req.params.captureId, user.workspace_id);
    if (!capture) throw new HttpError(404, 'Capture not found');
    if (capture.status === 'queued' || capture.status === 'running') throw new HttpError(409, 'This capture is already in progress', 'busy');
    await consumePages(user.id, 1);
    await query("UPDATE captures SET status = 'queued', error = NULL, job_id = NULL, source = 'auto', updated_at = now() WHERE id = $1", [capture.id]);
    await scheduleCaptures(capture.project_id);
    return { ok: true };
  });

  // UP-1: "Upload my own screenshot" replaces the cell with the user's image.
  app.post<{ Params: { captureId: string } }>('/captures/:captureId/upload', async (req) => {
    const user = await requireUser(req);
    const capture = await getCaptureForUser(req.params.captureId, user.workspace_id);
    if (!capture) throw new HttpError(404, 'Capture not found');
    const file = await req.file().catch(() => undefined);
    if (!file) throw new HttpError(400, 'Attach an image file', 'no_file');
    const buf = await file.toBuffer().catch(() => {
      throw new HttpError(413, 'The file is larger than 25 MB', 'too_large');
    });
    const img = inspectImage(buf);
    const key = `captures/${capture.project_id}/${capture.page_id}/${capture.device}-${capture.mode}-upload-${Date.now()}.${img.type}`;
    await getStorage().put(key, buf, contentTypes[img.type]);
    if (capture.image_key) await getStorage().delete(capture.image_key).catch(() => {});
    await query(
      "UPDATE captures SET status = 'done', error = NULL, source = 'upload', image_key = $2, width = $3, height = $4, updated_at = now() WHERE id = $1",
      [capture.id, key, img.width, img.height],
    );
    return { capture: (await listCaptures(capture.project_id)).find((c) => c.id === capture.id) };
  });

  // Viewports are editable per project (PRD "Viewports (defaults, editable per project)").
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/projects/:id/viewports', async (req) => {
    const project = await load(req);
    let viewports;
    try {
      viewports = validateViewports(req.body);
    } catch (err: any) {
      throw new HttpError(400, err.message, 'bad_viewports');
    }
    await query('UPDATE projects SET viewports = $2 WHERE id = $1', [project.id, JSON.stringify(viewports)]);
    return { viewports: viewportsFor(viewports) };
  });
}

/** Capture options a user may set (CE-7). Anything else is dropped. */
export function sanitiseOptions(input: unknown): Record<string, unknown> {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const out: Record<string, unknown> = {};
  if (o.dark === true) out.dark = true;
  if (Array.isArray(o.hideSelectors)) out.hideSelectors = o.hideSelectors.filter((s: unknown) => typeof s === 'string' && s.length < 200).slice(0, 20);
  if (Number.isFinite(o.delayMs)) out.delayMs = Math.max(0, Math.min(10_000, Number(o.delayMs)));
  return out;
}
