import type { FastifyInstance } from 'fastify';
import { contentTypes, inspectImage } from '@mockups/core/images';
import { getProject } from '@mockups/core/projects';
import { createShareLink, listShareLinks, revokeShareLink, sharedGallery } from '@mockups/core/share';
import { getStorage } from '@mockups/core/storage';
import { HttpError, requireUser } from '../app';

export async function shareRoutes(app: FastifyInstance) {
  // EX-4: create, list and revoke read-only gallery links.
  app.post<{ Params: { id: string } }>('/projects/:id/share', async (req, reply) => {
    const user = await requireUser(req);
    const project = await getProject(user, req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    return reply.status(201).send({ link: await createShareLink(project.id, user.id) });
  });

  app.get<{ Params: { id: string } }>('/projects/:id/share', async (req) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    return { links: await listShareLinks(project.id) };
  });

  app.delete<{ Params: { linkId: string } }>('/share-links/:linkId', async (req) => {
    const user = await requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.linkId) || !(await revokeShareLink(req.params.linkId, user.workspace_id))) throw new HttpError(404, 'Link not found');
    return { ok: true };
  });

  // Public, no session needed.
  app.get<{ Params: { token: string } }>('/share/:token', async (req) => {
    const gallery = await sharedGallery(req.params.token);
    if (!gallery) throw new HttpError(404, 'This link has expired or was turned off');
    return gallery;
  });

  // CX-4: client logo for presentation layouts.
  app.post<{ Params: { id: string } }>('/projects/:id/logo', async (req) => {
    const project = await getProject(await requireUser(req), req.params.id);
    if (!project) throw new HttpError(404, 'Project not found');
    const file = await req.file().catch(() => undefined);
    if (!file) throw new HttpError(400, 'Attach an image file', 'no_file');
    const buf = await file.toBuffer();
    const img = inspectImage(buf, ['png', 'jpg', 'webp']);
    const key = `projects/${project.id}/logo-${Date.now()}.${img.type}`;
    await getStorage().put(key, buf, contentTypes[img.type]);
    return { key, url: await getStorage().signedUrl(key) };
  });
}
