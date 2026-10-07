import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { verifySession } from '@mockups/core/auth';
import { findUser, type User } from '@mockups/core/users';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { jobRoutes } from './routes/jobs';
import { projectRoutes } from './routes/projects';
import { pageRoutes } from './routes/pages';
import { captureRoutes } from './routes/captures';
import { mockupRoutes } from './routes/mockups';
import { renderRoutes } from './routes/renders';
import { shareRoutes } from './routes/share';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
  }
}

export async function requireUser(req: FastifyRequest): Promise<User> {
  if (!req.user) throw new HttpError(401, 'Sign in required', 'unauthenticated');
  return req.user;
}

export async function requireAdmin(req: FastifyRequest): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'Admins only', 'forbidden');
  return user;
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 30 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 4 } });

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization?.replace(/^Bearer /, '');
    const userId = verifySession(req.cookies.sid ?? header);
    if (userId) req.user = await findUser(userId);
  });

  app.setErrorHandler((err: any, _req, reply: FastifyReply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    if (err.retryAfterSeconds) reply.header('retry-after', Math.ceil(err.retryAfterSeconds));
    reply.status(status).send({ error: err.code ?? 'error', message: status >= 500 ? 'Internal error' : err.message, ...(err.details ? { details: err.details } : {}) });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(fileRoutes);
  await app.register(jobRoutes);
  await app.register(projectRoutes);
  await app.register(pageRoutes);
  await app.register(captureRoutes);
  await app.register(mockupRoutes);
  await app.register(renderRoutes);
  await app.register(shareRoutes);
  return app;
}
