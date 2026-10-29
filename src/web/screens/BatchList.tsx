// Batch list (SPEC §8.2 item 1): newest first, one card per batch.
import { ColorDot, StatusBadge } from '@/components/Labels';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { acceptPress } from '@/lib/press';
import { useQuery } from '@/lib/query';
import { navigate } from '@/lib/router';
import type { BatchSummary } from '@/lib/types';

export function BatchList() {
  const { data: batches, loading } = useQuery<BatchSummary[]>('/api/batches');

  return (
    <Screen
      title={t('list.title')}
      footer={
        <Button size="lg" onClick={() => navigate('/new')}>
          {t('list.new')}
        </Button>
      }
    >
      {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {batches?.length === 0 && <p className="text-muted-foreground">{t('list.empty')}</p>}
      <ul className="flex flex-col gap-3">
        {batches?.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => acceptPress() && navigate(`/b/${b.id}`)}
              className="flex min-h-20 w-full items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left active:bg-accent"
            >
              <span className="text-3xl font-bold tabular-nums">#{b.number}</span>
              <ColorDot color={b.color} />
              <span className="flex min-w-0 flex-1 flex-col">
                {b.name && <span className="truncate text-lg font-medium">{b.name}</span>}
                {b.ferment_day !== null && (
                  <span className="text-lg text-muted-foreground">{t('list.day', { n: b.ferment_day })}</span>
                )}
              </span>
              <StatusBadge status={b.status} />
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
