// Add a step (SPEC §8.2 item 3): pick the type, and weighing mode opens for
// its additions (a cook, strain or rest with none goes back to the batch).
// The step is saved on the tap, dated today unless changed.
// In a batch from a recipe, the recipe's next step is offered first, with its
// method; the step gets the lines of the matching recipe step to weigh, and a
// mash line first when their plan depends on it.
import { useState } from 'react';
import { nextRecipeStep } from '../../shared/recipe.ts';
import { STEP_TYPES, type StepType } from '../../shared/schemas.ts';
import { DatePick } from '@/components/DatePick';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { stepTypeLabel, t } from '@/lib/i18n';
import { linesForNewStep } from '@/lib/plan';
import { invalidate, useQuery } from '@/lib/query';
import { goBack, navigate } from '@/lib/router';
import type { BatchView, RecipeView } from '@/lib/types';

// A batch has one ferment step; it is created with the batch.
const TYPES = STEP_TYPES.filter((type) => type !== 'ferment');

export function AddStep({ batchId }: { batchId: string }) {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const detail = `/b/${batchId}`;
  const batch = useQuery<BatchView>(`/api/batches/${batchId}`).data;
  const recipe = useQuery<RecipeView[]>('/api/recipes').data?.find((r) => r.id === batch?.recipe_id);
  const next = recipe && batch ? nextRecipeStep(recipe.steps, batch.steps) : null;
  const offer = next && next.type !== 'ferment' ? next : null;

  async function add(type: StepType) {
    const id = crypto.randomUUID();
    const position = (batch?.steps ?? []).reduce((max, s) => Math.max(max, s.position + 1), 0);
    const lines =
      recipe && batch
        ? linesForNewStep(recipe, { ...batch, steps: [...batch.steps, { id, type, position, date, params: {}, note: null, lines: [] }] }, id, t('step.mash'))
        : [];
    const saved = await toast.run(async () => {
      await api.post(`/api/batches/${batchId}/steps`, { id, type, date });
      for (const l of lines) await api.post(`/api/steps/${id}/lines`, { id: crypto.randomUUID(), ...l });
      return true;
    });
    if (!saved) return;
    invalidate('/api/batches');
    // A cook, strain or rest with nothing from the recipe has nothing to weigh.
    const weighs = lines.length > 0 || type === 'blend' || type === 'other';
    navigate(weighs ? `${detail}/s/${id}` : detail, { replace: true });
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
      {offer && (
        <div className="mt-6">
          <Button size="lg" className="w-full" onClick={() => void add(offer.type)}>
            {t('step.next', { type: stepTypeLabel(offer.type) })}
          </Button>
          {offer.note && <p className="mt-2 whitespace-pre-line text-lg text-muted-foreground">{offer.note}</p>}
        </div>
      )}
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
