import type { IncomingMessage, ServerResponse } from 'node:http';

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> | boolean;

const html = (res: ServerResponse, body: string, status = 200) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  return true;
};
const redirect = (res: ServerResponse, to: string, status = 302) => {
  res.writeHead(status, { location: to }).end();
  return true;
};

/** Generated responses per fixture site. */
export const dynamicRoutes: Record<string, Route> = {
  // Phase 1: redirects used by the SSRF tests.
  redirects(req, res, url) {
    if (url.pathname === '/to-metadata') return redirect(res, 'http://169.254.169.254/latest/meta-data/');
    if (url.pathname === '/to-loopback') return redirect(res, `http://127.0.0.1:${req.socket.localPort}/`);
    if (url.pathname === '/to-file') return redirect(res, 'file:///etc/passwd');
    if (url.pathname === '/to-ok') return redirect(res, '/final', 301);
    if (url.pathname === '/loop') return redirect(res, '/loop');
    if (url.pathname === '/final') return html(res, '<title>Final page</title><p>ok</p>');
    return false;
  },
  broken(_req, res, url) {
    if (url.pathname === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return true;
    }
    return html(res, '<h1>Server error</h1>', 500);
  },
};
