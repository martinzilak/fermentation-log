// A small read cache: screens show the last data at once and refetch in the
// background (stale-while-revalidate). Mutations call refresh() or
// invalidate() afterwards. Responses are kept in IndexedDB, so a reopened app
// shows the last data while the server is out of reach (SPEC §8.5), and
// writes the server hasn't confirmed are laid over them (overlay.ts).
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { HttpError } from './errors.ts';
import { todayIso } from './format.ts';
import { t } from './i18n.ts';
import { idbDelete, idbEntries, idbPut } from './idb.ts';
import type { Op } from './outbox.ts';
import { overlay, type OverlayContext } from './overlay.ts';
import { onSent, outbox } from './sync.ts';
import type { BottleType, Settings } from './types.ts';

interface Entry {
  data?: unknown;
  error?: unknown;
  /** Id of the latest request; older responses are ignored. */
  seq: number;
  /** Id of the request that fetched `data`. */
  dataSeq: number;
  loading: boolean;
}

const cache = new Map<string, Entry>();
const observers = new Map<string, number>();
const listeners = new Set<() => void>();
let seq = 0;
/** Bumped whenever the unconfirmed writes change. */
let version = 0;

/** Writes the server accepted, kept until data fetched after them arrives. */
const settled: { op: Op; seq: number; at: number }[] = [];
const SETTLED_MS = 5 * 60_000;
let refetchTimer: number | undefined;

function notify() {
  for (const l of listeners) l();
}

function set(url: string, patch: Partial<Entry>) {
  cache.set(url, { seq: 0, dataSeq: 0, loading: false, ...cache.get(url), ...patch });
  notify();
}

/** Fetches `url` into the cache, superseding any request already in flight. */
export async function refresh(url: string): Promise<void> {
  const mine = ++seq;
  set(url, { seq: mine, loading: true });
  try {
    const data = await api.get(url);
    if (cache.get(url)?.seq !== mine) return;
    set(url, { data, error: undefined, loading: false, dataSeq: mine });
    void idbPut('reads', data, url);
  } catch (error) {
    if (cache.get(url)?.seq !== mine) return;
    // Gone on the server: forget it. Out of reach: keep showing what we had.
    if (error instanceof HttpError && error.status === 404) {
      set(url, { data: undefined, error, loading: false });
      void idbDelete('reads', url);
    } else set(url, { error, loading: false });
  }
}

/** Refetches every URL on screen that starts with `prefix`; the rest refetch when shown. */
export function invalidate(prefix: string): void {
  for (const [url, n] of observers) if (n > 0 && url.startsWith(prefix)) void refresh(url);
}

/** What weighing, bottling and the batch screens read, so it's kept before it's needed offline. */
const REFERENCE = ['/api/batches', '/api/catalog', '/api/varieties', '/api/lots', '/api/lines/recent', '/api/bottle-types', '/api/settings', '/api/vessels', '/api/recipes'];

/** Fetches the reference data in the background; screens on show refresh themselves. */
export function prefetch(): void {
  for (const url of REFERENCE) if (!observers.get(url)) void refresh(url);
}

/** Loads the responses kept from earlier sessions; call before the first render. */
export async function hydrate(): Promise<void> {
  for (const [url, data] of await idbEntries('reads')) {
    if (typeof url === 'string' && !cache.has(url)) cache.set(url, { data, seq: 0, dataSeq: 0, loading: false });
  }
}

onSent((op) => {
  const now = Date.now();
  while (settled.length && settled[0]!.at < now - SETTLED_MS) settled.shift();
  settled.push({ op, seq: ++seq, at: now });
  version++;
  // Once a burst of replayed writes is through, fetch what they changed.
  window.clearTimeout(refetchTimer);
  refetchTimer = window.setTimeout(() => invalidate('/api/batches'), 300);
});
outbox.subscribe(() => {
  version++;
  notify();
});

function overlayContext(): OverlayContext {
  const bottles = cache.get('/api/bottle-types')?.data as BottleType[] | undefined;
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    today: todayIso(),
    targetSaltPct: (cache.get('/api/settings')?.data as Settings | undefined)?.target_salt_pct ?? 3,
    volumeMl: (id) => bottles?.find((b) => b.id === id)?.volume_ml,
  };
}

interface View {
  data: unknown;
  error: unknown;
}
const views = new Map<string, { entry: Entry | undefined; version: number; view: View }>();

function viewOf(url: string): View {
  const entry = cache.get(url);
  const memo = views.get(url);
  if (memo && memo.entry === entry && memo.version === version) return memo.view;
  const ops = [...settled.filter((s) => s.seq > (entry?.dataSeq ?? 0)).map((s) => s.op), ...outbox.pending()];
  const view = { data: overlay(url, entry?.data, ops, overlayContext()), error: entry?.error };
  views.set(url, { entry, version, view });
  return view;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether a failed read means the record doesn't exist, rather than the server being out of reach. */
export const isNotFound = (error: unknown) => error instanceof HttpError && error.status === 404;

/** The title of a screen whose record isn't there (yet). */
export function missingTitle(error: unknown): string {
  if (isNotFound(error)) return t('app.notFound');
  return error ? t('app.notCached') : t('common.loading');
}

export function useQuery<T>(url: string) {
  const { data, error } = useSyncExternalStore(subscribe, () => viewOf(url));
  useEffect(() => {
    observers.set(url, (observers.get(url) ?? 0) + 1);
    void refresh(url);
    return () => {
      observers.set(url, (observers.get(url) ?? 1) - 1);
    };
  }, [url]);
  return {
    data: data as T | undefined,
    error,
    loading: data === undefined && error === undefined,
  };
}
