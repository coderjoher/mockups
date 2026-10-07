import type { IncomingMessage, ServerResponse } from 'node:http';

type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> | boolean;

/** Generated responses per fixture site (filled in by later phases). */
export const dynamicRoutes: Record<string, Route> = {};
