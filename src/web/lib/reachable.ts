// Whether the server answered the last request (SPEC §8.5 banner). Every
// response and every failed request updates it.
import { useSyncExternalStore } from 'react';

let reachable = true;
const listeners = new Set<() => void>();

export const isReachable = () => reachable;

export function setReachable(value: boolean) {
  if (value === reachable) return;
  reachable = value;
  for (const l of listeners) l();
}

/** Calls `listener` whenever reachability changes; returns the unsubscribe. */
export function onReachableChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReachable(): boolean {
  return useSyncExternalStore(onReachableChange, isReachable);
}
