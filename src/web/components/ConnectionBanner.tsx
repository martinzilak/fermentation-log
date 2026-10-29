// SPEC §8.5: a large banner when the server can't be reached, with the
// number of writes waiting in the outbox, and a quiet one while they sync.
// Screen renders it inside its pinned header, so it never covers the title.
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { api, useReachable } from '@/lib/api';
import { t } from '@/lib/i18n';
import { invalidate, prefetch } from '@/lib/query';
import { outbox, usePendingCount } from '@/lib/sync';

const ping = () =>
  api.get('/api/me').then(
    () => {
      invalidate('/api/');
      prefetch();
    },
    () => {},
  );

/** Fetches the reference data at start, and checks the server again whenever the app comes back to the foreground. */
export function usePingOnVisible() {
  useEffect(() => {
    prefetch();
    const onVisible = () => document.visibilityState === 'visible' && void ping();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}

export type BannerState = { kind: 'offline' | 'syncing'; pending: number } | null;

export function useBanner(): BannerState {
  const reachable = useReachable();
  const pending = usePendingCount();
  if (!reachable) return { kind: 'offline', pending };
  return pending > 0 ? { kind: 'syncing', pending } : null;
}

const top = (min: string) => ({ paddingTop: `max(${min}, env(safe-area-inset-top))` });

export function ConnectionBanner({ state }: { state: NonNullable<BannerState> }) {
  if (state.kind === 'syncing') {
    return (
      <div role="status" className="bg-muted px-4 pb-2 text-lg" style={top('0.5rem')}>
        {t('sync.syncing', { n: state.pending })}
      </div>
    );
  }
  return (
    <div role="alert" className="flex items-center gap-3 bg-warn px-4 pb-3 text-lg font-semibold text-black" style={top('0.75rem')}>
      <div className="flex-1">
        <p>{t('app.offline')}</p>
        {state.pending > 0 && <p className="font-normal">{t('sync.waiting', { n: state.pending })}</p>}
      </div>
      <Button
        variant="outline"
        className="border-black/40 bg-transparent text-black"
        onClick={() => {
          void ping();
          outbox.retry();
        }}
      >
        {t('app.retry')}
      </Button>
    </div>
  );
}
