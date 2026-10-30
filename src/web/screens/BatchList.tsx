// Batch list (SPEC §8.2 item 1): newest first, one card per batch, its number
// as a plate in the cap colour (SPEC §15.12).
import { Plate, StatusBadge } from '@/components/Labels';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/button';
import { dayNumber } from '@/lib/format';
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
        <div className="flex gap-3">
          <Button variant="outline" className="h-16 px-5" onClick={() => navigate('/more')}>
            {t('list.more')}
          </Button>
          <Button size="lg" className="flex-1" onClick={() => navigate('/new')}>
            {t('list.new')}
          </Button>
        </div>
      }
    >
      {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {batches?.length === 0 && <p className="text-muted-foreground">{t('list.empty')}</p>}
      <ul className="flex flex-col gap-3">
        {batches?.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={(e) => acceptPress(e) && navigate(`/b/${b.id}`)}
              className="flex min-h-20 w-full items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left active:bg-accent"
            >
              <Plate number={b.number} color={b.color} />
              {/* The name gets its own line, so it's never cut short. */}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {b.name && <span className="font-display text-2xl leading-none font-bold break-words uppercase">{b.name}</span>}
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge status={b.status} />
                  {b.ferment_day !== null && (
                    <span className="font-mono text-sm text-muted-foreground">{t('list.day', { n: dayNumber(b.ferment_day) })}</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
