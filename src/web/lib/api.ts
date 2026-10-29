// Thin fetch wrapper for the JSON API (SPEC §11). Every response also tells
// the connection store whether the server is reachable (SPEC §8.5 banner).
// Writes to batches and their contents go through the outbox, which resolves
// them to QUEUED when the server can't be reached.
import { HttpError, OfflineError } from './errors.ts';
import { QUEUED, usesOutbox } from './outbox.ts';
import { setReachable } from './reachable.ts';
import { outbox } from './sync.ts';

export { HttpError, OfflineError, QUEUED };
export { useReachable } from './reachable.ts';

const TIMEOUT_MS = 10_000;

const EVENTS = /^\/api\/batches\/[^/]+\/events$/;

/** An event is dated when it is logged, not when a queued write reaches the server. */
function stamp(method: string, url: string, body: unknown): unknown {
  if (method !== 'POST' || !EVENTS.test(url) || typeof body !== 'object' || body === null || 'occurred_at' in body) return body;
  return { ...body, occurred_at: new Date().toISOString() };
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  if (method !== 'GET' && usesOutbox(method, url)) return (await outbox.send(method, url, stamp(method, url, body))) as T;
  const json = body !== undefined && !(body instanceof FormData);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: json ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? null : json ? JSON.stringify(body) : (body as FormData),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    setReachable(false);
    throw new OfflineError('Offline');
  }
  // Tailscale Serve answers for a container that is down.
  if (res.status >= 502 && res.status <= 504) {
    setReachable(false);
    throw new OfflineError('Offline');
  }
  setReachable(true);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new HttpError(res.status, data?.error ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: (url: string) => request<void>('DELETE', url),
};
