// Add a step (SPEC §8.2 item 3): pick the type, and weighing mode opens for
// its additions. The step is saved on the tap, dated today unless changed.
import { useState } from 'react';
import { STEP_TYPES, type StepType } from '../../shared/schemas.ts';
import { DatePick } from '@/components/DatePick';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { stepTypeLabel, t } from '@/lib/i18n';
import { invalidate } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';

// A batch has one ferment step; it is created with the batch.
const TYPES = STEP_TYPES.filter((type) => type !== 'ferment');

export function AddStep({ batchId }: { batchId: string }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const detail = `/b/${batchId}`;

  async function add(type: StepType) {
    const id = crypto.randomUUID();
    const saved = await toast.run(() => api.post(`/api/batches/${batchId}/steps`, { id, type, date }));
    if (!saved) return;
    invalidate('/api/batches');
    navigate(`${detail}/s/${id}`, { replace: true });
    toast.show(t('step.added', { type: stepTypeLabel(type) }), async () => {
      await api.del(`/api/steps/${id}`);
      invalidate('/api/batches');
      goBack(detail);
    });
  }

  return (
    <Screen
      title={t('step.title')}
      footer={
        <Button variant="outline" onClick={() => goBack(detail)}>
          {t('common.back')}
        </Button>
      }
    >
      <h2 className="mb-2 text-lg text-muted-foreground">{t('step.date')}</h2>
      <DatePick value={date} onChange={setDate} />
      <div className="mt-6 grid grid-cols-2 gap-3">
        {TYPES.map((type) => (
          <Button key={type} size="lg" variant="secondary" onClick={() => void add(type)}>
            {stepTypeLabel(type)}
          </Button>
        ))}
      </div>
    </Screen>
  );
}
