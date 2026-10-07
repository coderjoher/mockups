import type { FastifyInstance } from 'fastify';
import { authenticateApiKey } from '@mockups/core/apikeys';
import { captureRoutes } from './captures';
import { libraryRoutes } from './mockups';
import { pageRoutes } from './pages';
import { projectRoutes } from './projects';
import { renderRoutes } from './renders';
import { OPENAPI } from '../openapi';

/**
 * SC-2: the public API. The same handlers as the web app, under /v1, authenticated only by API key
 * (sessions and cookies are ignored here), with a per-key rate limit.
 */
export async function publicApi(app: FastifyInstance) {
  app.get('/v1/openapi.json', async () => OPENAPI);
  await app.register(async (v1) => {
    v1.addHook('onRequest', async (req) => {
      req.user = undefined;
      const key = req.headers.authorization?.replace(/^Bearer /, '');
      req.user = (await authenticateApiKey(key)).user;
    });
    await v1.register(projectRoutes);
    await v1.register(pageRoutes);
    await v1.register(captureRoutes);
    await v1.register(renderRoutes);
    await v1.register(libraryRoutes); // library browsing only; admin routes are not public
  }, { prefix: '/v1' });
}
