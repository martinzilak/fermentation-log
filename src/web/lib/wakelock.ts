// Keeps the screen on during flows (SPEC §8.1 item 8). iOS releases the lock
// whenever the app is hidden, so it is taken again on return. Fails silently
// where the Screen Wake Lock API is missing or refused.
import { useEffect } from 'react';

export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const take = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (active) lock = next;
        else void next.release();
      } catch {
        // Low battery mode, or not allowed: the screen just dims as usual.
      }
    };
    void take();
    document.addEventListener('visibilitychange', take);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, []);
}
