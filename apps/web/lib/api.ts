'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Calls the API through the Next.js /api rewrite so the session cookie is same-origin. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'error', body?.message ?? res.statusText);
  return body as T;
}
