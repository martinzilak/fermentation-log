// New batch, blank (SPEC §8.2 item 2): number and start date, then straight
// into weighing mode. The batch and its ferment step are saved on Start, so
// leaving the weighing flow later loses nothing.
import { Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Chip, Chips } from '@/components/Chip';
import { DatePick } from '@/components/DatePick';
import { ColorDot } from '@/components/Labels';
import { ActionRow, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { t } from '@/lib/i18n';
import { invalidate, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import type { BatchSummary } from '@/lib/types';

const COLORS = ['red', 'orange', 'yellow', 'green', 'brown', 'purple'] as const;

export function NewBatch() {
  const toast = useToast();
  const { data: batches } = useQuery<BatchSummary[]>('/api/batches');
  const next = (batches ?? []).reduce((max, b) => Math.max(max, b.number), 0) + 1;
  const [number, setNumber] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [color, setColor] = useState<string | null>(null);
  const shown = number ?? next;
  // Fixed for this screen, so a retry after a half-finished save reuses them.
  const ids = useRef({ batch: crypto.randomUUID(), step: crypto.randomUUID() }).current;

  async function start() {
    const { batch: batchId, step: stepId } = ids;
    const created = await toast.run(async () => {
      await api.post('/api/batches', { id: batchId, number: shown, color });
      await api.post(`/api/batches/${batchId}/steps`, { id: stepId, type: 'ferment', date, params: {} });
      return true;
    });
    invalidate('/api/batches');
    if (!created) return;
    navigate(`/b/${batchId}/s/${stepId}`, { replace: true });
    toast.show(t('new.started', { n: shown }), async () => {
      await api.del(`/api/batches/${batchId}`);
      invalidate('/api/batches');
      navigate('/', { replace: true });
    });
  }

  return (
    <Screen
      title={t('new.title')}
      fixed
      footer={
        <>
          <Button size="lg" disabled={!batches} onClick={() => void start()}>
            {t('new.start')}
          </Button>
          <Button variant="outline" onClick={() => goBack('/')}>
            {t('common.back')}
          </Button>
        </>
      }
    >
      <section className="flex flex-col gap-6">
        <div>
          <h2 className="mb-2 text-lg text-muted-foreground">{t('new.number')}</h2>
          <ActionRow>
            <Button variant="outline" size="icon" aria-label={t('new.fewer')} onClick={() => setNumber(Math.max(1, shown - 1))}>
              <Minus />
            </Button>
            <p className="self-center text-center text-5xl font-bold tabular-nums">#{shown}</p>
            <Button variant="outline" size="icon" aria-label={t('new.more')} onClick={() => setNumber(shown + 1)}>
              <Plus />
            </Button>
          </ActionRow>
        </div>
        <div>
          <h2 className="mb-2 text-lg text-muted-foreground">{t('new.date')}</h2>
          <DatePick value={date} onChange={setDate} />
        </div>
        <div>
          <h2 className="mb-2 text-lg text-muted-foreground">{t('new.color')}</h2>
          <Chips>
            <Chip selected={color === null} onClick={() => setColor(null)}>
              {t('new.noColor')}
            </Chip>
            {COLORS.map((c) => (
              <Chip key={c} selected={color === c} onClick={() => setColor(c)}>
                <span className="flex items-center gap-2">
                  <ColorDot color={c} />
                  {t(`color.${c}`)}
                </span>
              </Chip>
            ))}
          </Chips>
        </div>
      </section>
    </Screen>
  );
}
