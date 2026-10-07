import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createFixtureServer } from '../fixtures/server';

/** Starts the fixture websites on a random port; *.fixture.test maps to it. */
export async function startFixtures(): Promise<{ server: Server; port: number; url: (site: string, path?: string) => string }> {
  process.env.FIXTURE_HOSTS = 'fixture.test=127.0.0.1';
  const server = createFixtureServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { server, port, url: (site, path = '/') => `http://${site}.fixture.test:${port}${path}` };
}
