import type { FastifyInstance } from 'fastify';
import { one } from '@mockups/core/db';
import { getJob } from '@mockups/core/queue';
import { HttpError, requireUser } from '../app';

export async function jobRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/jobs/:id', async (req) => {
    const user = await requireUser(req);
    const job = await getJob(req.params.id).catch(() => undefined);
    const owner = job?.project_id ? await one('SELECT workspace_id FROM projects WHERE id = $1', [job.project_id]) : undefined;
    if (!job || owner?.workspace_id !== user.workspace_id) throw new HttpError(404, 'Job not found');
    return { job };
  });
}
