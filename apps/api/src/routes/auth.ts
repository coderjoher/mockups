import type { FastifyInstance } from 'fastify';
import { signSession, verifyPassword } from '@mockups/core/auth';
import { findUserByEmail } from '@mockups/core/users';
import { HttpError, requireUser } from '../app';

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>('/auth/login', async (req, reply) => {
    const { email = '', password = '' } = req.body ?? {};
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'Wrong email or password', 'bad_credentials');
    const token = signSession(user.id);
    reply.setCookie('sid', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, locale: user.locale } };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (req) => ({ user: await requireUser(req) }));
}
