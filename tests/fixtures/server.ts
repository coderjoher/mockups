// Local fixture websites for discovery/capture tests. Each site is chosen by the
// subdomain of <site>.fixture.test (mapped to 127.0.0.1 in tests only).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dynamicRoutes } from './dynamic';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sites');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' };

export function createFixtureServer() {
  return http.createServer(async (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const site = host.endsWith('.fixture.test') ? host.slice(0, -'.fixture.test'.length) : 'basic';
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const dyn = dynamicRoutes[site];
    if (dyn && (await dyn(req, res, url))) return;
    let file = path.join(root, site, decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, site))) return void res.writeHead(400).end();
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FIXTURE_PORT ?? 4100);
  createFixtureServer().listen(port, '127.0.0.1', () => console.log(`fixtures on ${port}`));
}
