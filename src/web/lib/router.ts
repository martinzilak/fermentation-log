// History-based routing for a handful of screens. Each entry remembers the
// path it was opened from, so a screen's Back or Done can return with
// history.back() (keeping the iOS swipe-back gesture consistent) and only
// falls back to a fresh navigation when the app was opened on that screen.
import { useSyncExternalStore } from 'react';

interface RouteState {
  from: string | null;
}

const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
window.addEventListener('popstate', emit);

const currentState = (): RouteState | null => history.state as RouteState | null;

export function navigate(to: string, { replace = false } = {}): void {
  if (replace) {
    history.replaceState({ from: currentState()?.from ?? null }, '', to);
  } else {
    history.pushState({ from: location.pathname }, '', to);
  }
  window.scrollTo(0, 0);
  emit();
}

/** Returns to `to`: back through history if this screen was opened from it, else by replacing. */
export function goBack(to: string): void {
  if (currentState()?.from === to) history.back();
  else navigate(to, { replace: true });
}

export function usePath(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => location.pathname,
  );
}

/** Matches `/b/:id`-style patterns; returns the params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = (path.length > 1 ? path.replace(/\/$/, '') : path).split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!;
    const g = got[i] ?? '';
    if (w.startsWith(':')) params[w.slice(1)] = decodeURIComponent(g);
    else if (w !== g) return null;
  }
  return params;
}
