import type { FastifyInstance } from 'fastify';
import { createApiKey, listApiKeys, revokeApiKey } from '@mockups/core/apikeys';
import { signSession } from '@mockups/core/auth';
import { one } from '@mockups/core/db';
import { billingSummary, handleBillingWebhook } from '@mockups/core/plans';
import { scalingAdvice } from '@mockups/core/scale';
import { createUser, createWorkspace } from '@mockups/core/users';
import { HttpError, requireAdmin, requireUser } from '../app';

export async function accountRoutes(app: FastifyInstance) {
  // SC-3: self-service sign-up into a free plan.
  app.post<{ Body: { name?: string; email?: string; password?: string; workspace?: string; locale?: 'en' | 'ar' } }>('/auth/signup', async (req, reply) => {
    if (process.env.SIGNUP_DISABLED === '1') throw new HttpError(403, 'Sign-up is closed', 'signup_closed');
    const { name = '', email = '', password = '', workspace, locale } = req.body ?? {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 10 || !name.trim()) {
      throw new HttpError(400, 'Enter your name, a valid email and a password of at least 10 characters', 'bad_signup');
    }
    if (await one('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()])) throw new HttpError(409, 'An account with this email already exists', 'email_taken');
    const ws = await createWorkspace((workspace || `${name}'s workspace`).slice(0, 80));
    await one("UPDATE workspaces SET plan = 'free' WHERE id = $1 RETURNING id", [ws.id]);
    const user = await createUser({ workspaceId: ws.id, name: name.trim().slice(0, 80), email, password, locale: locale === 'ar' ? 'ar' : 'en' });
    const token = signSession(user.id);
    reply.setCookie('sid', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return reply.status(201).send({ token, user });
  });

  app.get('/billing', async (req) => billingSummary((await requireUser(req)).workspace_id));

  // Raw body for the signature check.
  await app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hooks.post('/billing/webhook', async (req) => {
      const res = await handleBillingWebhook(String(req.body ?? ''), req.headers['x-billing-signature'] as string | undefined);
      return { ok: true, ...res };
    });
  });

  // SC-2: API keys.
  app.get('/api-keys', async (req) => ({ keys: await listApiKeys((await requireUser(req)).id) }));
  app.post<{ Body: { name?: string } }>('/api-keys', async (req, reply) => reply.status(201).send(await createApiKey((await requireUser(req)).id, req.body?.name ?? 'API key')));
  app.delete<{ Params: { id: string } }>('/api-keys/:id', async (req) => {
    const user = await requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !(await revokeApiKey(user.id, req.params.id))) throw new HttpError(404, 'Key not found');
    return { ok: true };
  });

  // SC-4: scaling advice for the autoscaler script.
  app.get('/admin/metrics/queues', async (req) => {
    await requireAdmin(req);
    return scalingAdvice();
  });
}
