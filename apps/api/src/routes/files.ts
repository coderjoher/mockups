import type { FastifyInstance } from 'fastify';
import { getStorage, verifySignedKey } from '@mockups/core/storage';
import { HttpError } from '../app';

const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', zip: 'application/zip', txt: 'text/plain; charset=utf-8', mp4: 'video/mp4' };

// Serves local-storage files only through HMAC-signed, expiring URLs (F-6).
export async function fileRoutes(app: FastifyInstance) {
  app.get<{ Params: { '*': string }; Querystring: { exp?: string; sig?: string; dl?: string } }>('/files/*', async (req, reply) => {
    const key = req.params['*'];
    if (!verifySignedKey(key, Number(req.query.exp), req.query.sig ?? '')) throw new HttpError(403, 'Link expired or invalid', 'bad_signature');
    const body = await getStorage().get(key).catch(() => {
      throw new HttpError(404, 'Not found');
    });
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    reply.header('content-type', types[ext] ?? 'application/octet-stream').header('cache-control', 'private, max-age=3600');
    // EX-3: ?dl=<name> downloads the file under its export name.
    const dl = (req.query as any).dl as string | undefined;
    if (dl) {
      const name = dl === '1' ? key.split('/').pop()! : dl.replace(/[\\/\r\n"]/g, '').slice(0, 200);
      const ascii = name.replace(/[^\x20-\x7e]/g, '_');
      reply.header('content-disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    return reply.send(body);
  });
}
