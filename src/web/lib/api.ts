// Thin fetch wrapper for the JSON API (SPEC §11). Every response also tells
// the connection store whether the server is reachable (SPEC §8.5 banner).
import { useSyncExternalStore } from 'react';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The request never reached the server: Tailscale off, no network, server down. */
export class OfflineError extends Error {}

let reachable = true;
const listeners = new Set<() => void>();

function setReachable(value: boolean) {
  if (value === reachable) return;
  reachable = value;
  for (const l of listeners) l();
}

export function useReachable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => reachable,
  );
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: json ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? null : json ? JSON.stringify(body) : (body as FormData),
    });
  } catch {
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
