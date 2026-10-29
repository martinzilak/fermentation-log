// A small read cache: screens show the last data at once and refetch in the
// background (stale-while-revalidate). Mutations call refresh() or
// invalidate() afterwards. Kept in memory only; the offline outbox is M4.
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';

interface Entry {
  data?: unknown;
  error?: unknown;
  /** Id of the latest request; older responses are ignored. */
  seq: number;
  loading: boolean;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let seq = 0;

function set(url: string, patch: Partial<Entry>) {
  cache.set(url, { seq: 0, loading: false, ...cache.get(url), ...patch });
  for (const l of listeners) l();
}

/** Fetches `url` into the cache, superseding any request already in flight. */
export async function refresh(url: string): Promise<void> {
  const mine = ++seq;
  set(url, { seq: mine, loading: true });
  try {
    const data = await api.get(url);
    if (cache.get(url)?.seq === mine) set(url, { data, error: undefined, loading: false });
  } catch (error) {
    if (cache.get(url)?.seq === mine) set(url, { error, loading: false });
  }
}

/** Refetches every cached URL that starts with `prefix`. */
export function invalidate(prefix: string): void {
  for (const url of cache.keys()) if (url.startsWith(prefix)) void refresh(url);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useQuery<T>(url: string) {
  const entry = useSyncExternalStore(subscribe, () => cache.get(url));
  useEffect(() => {
    void refresh(url);
  }, [url]);
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: entry?.data === undefined && entry?.error === undefined,
  };
}
