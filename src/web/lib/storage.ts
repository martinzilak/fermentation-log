// localStorage for small per-device conveniences (drafts, last pH method).
// Never required: when storage is unavailable, reads return null.

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(`ferment:${key}`);
  } catch {
    return null;
  }
}

/** Stores `value`, or removes the key when it is null. */
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`ferment:${key}`);
    else localStorage.setItem(`ferment:${key}`, value);
  } catch {
    // Private mode or full storage: the convenience is simply lost.
  }
}
