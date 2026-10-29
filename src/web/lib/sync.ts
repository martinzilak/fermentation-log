// The browser's outbox (SPEC §8.5): stored in IndexedDB, retried when the
// network or the app comes back, and when any request reaches the server.
import { useSyncExternalStore } from 'react';
import type { HttpError } from './errors.ts';
import { idbDelete, idbEntries, idbPut } from './idb.ts';
import { Outbox, type Op } from './outbox.ts';
import { isReachable, onReachableChange, setReachable } from './reachable.ts';

const sent = new Set<(op: Op) => void>();
const refused = new Set<(op: Op, error: HttpError) => void>();

export const outbox = new Outbox({
  store: {
    load: async () => (await idbEntries<Op>('outbox')).map(([, op]) => op),
    put: (op) => idbPut('outbox', op),
    remove: (seq) => idbDelete('outbox', seq),
  },
  fetch: (url, init) => fetch(url, init),
  isReachable,
  setReachable,
  onSent: (op) => sent.forEach((l) => l(op)),
  onRefused: (op, error) => refused.forEach((l) => l(op, error)),
});

function listen<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => set.delete(listener);
}

/** Called for each write the server accepts. */
export const onSent = (listener: (op: Op) => void) => listen(sent, listener);
/** Called for a queued write the server refused after its screen was left. */
export const onRefused = (listener: (op: Op, error: HttpError) => void) => listen(refused, listener);

let started = false;

export function startSync(): void {
  if (started) return;
  started = true;
  void outbox.load();
  window.addEventListener('online', () => outbox.retry());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && outbox.retry());
  onReachableChange(() => isReachable() && outbox.retry());
}

export function usePendingCount(): number {
  return useSyncExternalStore(
    (l) => outbox.subscribe(l),
    () => outbox.pending().length,
  );
}
