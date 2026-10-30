// New batch (SPEC §8.2 item 2): blank or from a recipe, number and start
// date, then straight into weighing mode. The batch and its ferment step are
// saved on Start, so leaving the weighing flow later loses nothing. From a
// recipe, the ferment step also gets the recipe's lines, still to weigh; their
// plans follow what is actually weighed (SPEC §7.3). The colour (of the caps or
// labels) is chosen at bottling (SPEC §15.5). Whether the container needs
// burping (SPEC §15.11) starts as last time's answer on this phone. The short
// choices come first; the recipes are a list, the picked one opening in place.
import { Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Chip, Chips } from '@/components/Chip';
import { DatePick } from '@/components/DatePick';
import { ActionRow, Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { t } from '@/lib/i18n';
import { recipeLineText } from '@/lib/recipes';
import { invalidate, useQuery } from '@/lib/query';
import { readLocal, writeLocal } from '@/lib/storage';
import { goBack, navigate } from '@/lib/router';
import type { BatchSummary, RecipeLineView, RecipeView } from '@/lib/types';
import { useWakeLock } from '@/lib/wakelock';

export function NewBatch() {
  useWakeLock();
  const toast = useToast();
  const { data: batches } = useQuery<BatchSummary[]>('/api/batches');
  const next = (batches ?? []).reduce((max, b) => Math.max(max, b.number), 0) + 1;
  const [number, setNumber] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const recipes = useQuery<RecipeView[]>('/api/recipes').data ?? [];
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [needsBurping, setNeedsBurping] = useState(() => readLocal('needsBurping') === '1');
  const recipe = recipes.find((r) => r.id === recipeId);
  const fermentLines = recipe ? firstFermentLines(recipe) : [];
  const shown = number ?? next;
  // Fixed for this screen, so a retry after a half-finished save reuses them.
  const ids = useRef({ batch: crypto.randomUUID(), step: crypto.randomUUID(), lines: new Map<string, string>() }).current;
  const lineId = (recipeLineId: string) => ids.lines.get(recipeLineId) ?? ids.lines.set(recipeLineId, crypto.randomUUID()).get(recipeLineId)!;

  async function start() {
    const { batch: batchId, step: stepId } = ids;
    const created = await toast.run(async () => {
      // A batch from a recipe is named after it, which the edit screen can change.
      await api.post('/api/batches', { id: batchId, number: shown, name: recipe?.name ?? null, recipe_id: recipe?.id ?? null });
      await api.post(`/api/batches/${batchId}/steps`, { id: stepId, type: 'ferment', date, params: { needs_burping: needsBurping } });
      for (const l of fermentLines) {
        await api.post(`/api/steps/${stepId}/lines`, {
          id: lineId(l.id),
          name: l.name,
          kind: l.kind,
          variety_id: l.variety_id,
          catalog_id: l.catalog_id,
          planned_g: l.mode === 'grams' && !l.solve_for_heat ? l.grams : null,
        });
      }
      return true;
    });
    invalidate('/api/batches');
    if (!created) return;
    writeLocal('needsBurping', needsBurping ? '1' : null);
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
          <h2 className="mb-2 font-mono text-sm tracking-widest text-muted-foreground uppercase">{t('new.number')}</h2>
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
          <h2 className="mb-2 font-mono text-sm tracking-widest text-muted-foreground uppercase">{t('new.date')}</h2>
          <DatePick value={date} onChange={setDate} />
        </div>
        <div>
          <h2 className="mb-2 font-mono text-sm tracking-widest text-muted-foreground uppercase">{t('new.container')}</h2>
          <Chips>
            <Chip selected={!needsBurping} hint={t('new.selfVentingHint')} onClick={() => setNeedsBurping(false)}>
              {t('new.selfVenting')}
            </Chip>
            <Chip selected={needsBurping} hint={t('new.needsBurpingHint')} onClick={() => setNeedsBurping(true)}>
              {t('new.needsBurping')}
            </Chip>
          </Chips>
        </div>
        {recipes.length > 0 && (
          <div>
            <h2 className="mb-2 font-mono text-sm tracking-widest text-muted-foreground uppercase">{t('new.recipe')}</h2>
            <div className="flex flex-col gap-3">
              <Chip selected={!recipe} className="w-full" onClick={() => setRecipeId(null)}>
                {t('new.blank')}
              </Chip>
              {recipes.map((r) => (
                <div key={r.id}>
                  <Chip selected={r.id === recipeId} className="w-full" onClick={() => setRecipeId(r.id)}>
                    {r.name}
                  </Chip>
                  {r.id === recipeId && (
                    <ul className="mt-2 divide-y rounded-xl border">
                      {fermentLines.map((l) => (
                        <li key={l.id} className="flex justify-between gap-4 px-4 py-2 text-lg">
                          <span>{l.name}</span>
                          <span className="text-right text-muted-foreground tabular-nums">{recipeLineText(l)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </Screen>
  );
}

/** The lines of the recipe's first ferment step, which the new batch starts with. */
function firstFermentLines(recipe: RecipeView): RecipeLineView[] {
  const ferment = recipe.lines.filter((l) => l.step_type === 'ferment');
  const index = Math.min(...ferment.map((l) => l.step_index));
  return ferment.filter((l) => l.step_index === index);
}
