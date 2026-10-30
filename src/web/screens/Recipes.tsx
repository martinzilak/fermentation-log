// Recipes (SPEC §7.3, §8.2 item 6): the list, and the editor with a live
// calculator. Like the other edit screens every field saves on its own with
// Undo; a change to a line saves all the lines, and a change to a step all the
// steps, as the API takes them whole.
// The calculator tries the recipe with the grams you have, and shows the heat
// against the goal, without saving anything.
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { BASES, KINDS, STEP_TYPES, type Kind, type StepType } from '../../shared/schemas.ts';
import { fold } from '../../shared/names.ts';
import { evaluateRecipe, type Evaluation, type RecipeStep } from '../../shared/recipe.ts';
import type { Base } from '../../shared/calc.ts';
import { Chip, Chips } from '@/components/Chip';
import { LinkRow, NumberField, RowList, Section, TextField, usePatch } from '@/components/Edit';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { kindLabel, stepTypeLabel, t } from '@/lib/i18n';
import { formatGrams, formatNumber, formatShuRange, parseDecimal } from '@/lib/numbers';
import { invalidate, missingTitle, useQuery } from '@/lib/query';
import { baseLabel, recipeLineText } from '@/lib/recipes';
import { goBack, navigate } from '@/lib/router';
import type { CatalogItem, RecipeLineView, RecipeView, Settings, Variety } from '@/lib/types';

const LIST = '/api/recipes';

function hint(r: RecipeView): string {
  const parts = [t('recipe.ingredients', { n: r.lines.length })];
  if (r.heat_target_shu !== null) parts.push(t('recipe.goalHint', { shu: formatNumber(r.heat_target_shu) }));
  return parts.join(' · ');
}

export function RecipeList() {
  const toast = useToast();
  const { data, loading } = useQuery<RecipeView[]>(LIST);
  const [query, setQuery] = useState('');
  const q = fold(query);
  const shown = (data ?? []).filter((r) => !q || fold(r.name).includes(q));
  const exact = (data ?? []).some((r) => fold(r.name) === q);

  async function add() {
    const id = crypto.randomUUID();
    if (!(await toast.run(() => api.post(LIST, { id, name: query.trim() })))) return;
    invalidate(LIST);
    setQuery('');
    navigate(`/recipes/${id}`);
  }

  return (
    <Screen
      title={t('recipes.title')}
      footer={
        <Button variant="outline" onClick={() => goBack('/more')}>
          {t('common.back')}
        </Button>
      }
    >
      <Input placeholder={t('edit.searchOrAdd')} aria-label={t('edit.searchOrAdd')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {q && !exact && (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => void add()}>
          {t('edit.add', { name: query.trim() })}
        </Button>
      )}
      <div className="mt-4">
        {loading && <p className="text-muted-foreground">{t('common.loading')}</p>}
        {data && data.length === 0 && !q && <p className="text-lg text-muted-foreground">{t('recipes.none')}</p>}
        {shown.length > 0 && (
          <RowList>
            {shown.map((r) => (
              <LinkRow key={r.id} title={r.name} hint={hint(r)} onClick={() => navigate(`/recipes/${r.id}`)} />
            ))}
          </RowList>
        )}
      </div>
    </Screen>
  );
}

/** What PATCH takes for a line. */
function lineBody(l: RecipeLineView) {
  const { id, step_index, step_type, position, name, kind, mode, grams, percent, base, solve_for_heat, variety_id, catalog_id } = l;
  return { id, step_index, step_type, position, name, kind, mode, grams, percent, base, solve_for_heat, variety_id, catalog_id };
}

/** A new line's amount: peppers in grams, salt against the ferment, the rest against peppers or, later, the mash. */
function defaultAmount(kind: Kind, stepType: StepType, saltPct: number): Pick<RecipeLineView, 'mode' | 'grams' | 'percent' | 'base'> {
  if (stepType === 'ferment') {
    if (kind === 'pepper') return { mode: 'grams', grams: null, percent: null, base: null };
    if (kind === 'salt') return { mode: 'percent', grams: null, percent: saltPct, base: 'ferment_total' };
    return { mode: 'percent', grams: null, percent: 0, base: 'peppers' };
  }
  return { mode: 'percent', grams: null, percent: 0, base: kind === 'thickener' ? 'sauce' : 'mash' };
}

const selectClass = 'h-14 w-full min-w-0 rounded-xl border border-input bg-transparent px-3 text-lg dark:bg-input/30';

export function RecipeEditor({ id }: { id: string }) {
  const { data, error } = useQuery<RecipeView[]>(LIST);
  const varieties = useQuery<Variety[]>('/api/varieties').data ?? [];
  const catalog = useQuery<CatalogItem[]>('/api/catalog').data ?? [];
  const saltPct = useQuery<Settings>('/api/settings').data?.target_salt_pct ?? 3;
  const save = usePatch(`/api/recipes/${id}`, [LIST]);
  const recipe = data?.find((r) => r.id === id);
  const back = () => goBack('/recipes');

  if (!recipe) {
    return (
      <Screen
        title={data ? t('app.notFound') : missingTitle(error)}
        footer={
          <Button variant="outline" onClick={back}>
            {t('common.back')}
          </Button>
        }
      />
    );
  }
  const r = recipe;

  // A new recipe starts with its ferment.
  const steps: RecipeStep[] = r.steps.length > 0 ? r.steps : [{ step_index: 0, type: 'ferment', note: null }];
  const nextIndex = steps.reduce((max, s) => Math.max(max, s.step_index + 1), 0);

  const saveLines = (next: RecipeLineView[]) => save({ lines: next.map(lineBody) }, { lines: r.lines.map(lineBody) });
  const saveSteps = (next: RecipeStep[]) => save({ steps: next }, { steps: r.steps });
  const removeStep = (index: number) =>
    save(
      { steps: steps.filter((s) => s.step_index !== index), lines: r.lines.filter((l) => l.step_index !== index).map(lineBody) },
      { steps: r.steps, lines: r.lines.map(lineBody) },
    );
  const change = (lineId: string, patch: Partial<RecipeLineView>) =>
    saveLines(r.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : patch.solve_for_heat ? { ...l, solve_for_heat: false } : l)));

  /** The entry a typed name refers to, so the server links the line to it. */
  function identify(name: string): Pick<RecipeLineView, 'name' | 'kind' | 'variety_id' | 'catalog_id'> | null {
    const key = fold(name);
    const named = (e: { name: string; aliases: string[] }) => [e.name, ...e.aliases].some((n) => fold(n) === key);
    const variety = varieties.find(named);
    if (variety) return { name: variety.name, kind: 'pepper', variety_id: variety.id, catalog_id: null };
    const item = catalog.find(named);
    return item ? { name: item.name, kind: item.kind, variety_id: null, catalog_id: item.id } : null;
  }

  async function addLine(index: number, type: StepType, name: string) {
    const known = identify(name);
    const kind = known?.kind ?? 'other';
    const position = r.lines.filter((l) => l.step_index === index).reduce((max, l) => Math.max(max, l.position + 1), 0);
    const line: RecipeLineView = {
      id: crypto.randomUUID(),
      recipe_id: r.id,
      step_index: index,
      step_type: type,
      position,
      name: known?.name ?? name,
      kind,
      variety_id: known?.variety_id ?? null,
      catalog_id: known?.catalog_id ?? null,
      ...defaultAmount(kind, type, saltPct),
      solve_for_heat: false,
      shu_min: null,
      shu_max: null,
    };
    await saveLines([...r.lines, line]);
  }

  return (
    <Screen
      title={r.name}
      subtitle={t('recipe.subtitle')}
      footer={
        <Button variant="outline" onClick={back}>
          {t('common.back')}
        </Button>
      }
    >
      <datalist id="recipe-names">
        {[...varieties, ...catalog].map((e) => (
          <option key={e.id} value={e.name} />
        ))}
      </datalist>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label={t('recipe.name')} value={r.name} required onSave={(name) => save({ name }, { name: r.name })} />
        <NumberField
          label={t('recipe.heatGoal')}
          value={r.heat_target_shu}
          placeholder={t('recipe.heatGoalNone')}
          onSave={(heat_target_shu) => save({ heat_target_shu }, { heat_target_shu: r.heat_target_shu })}
        />
      </div>

      {steps.map((s, i) => (
        <Section
          key={s.step_index}
          title={<span className="text-xl font-semibold text-foreground">{t('recipe.step', { n: i + 1, type: stepTypeLabel(s.type) })}</span>}
        >
          <div className="mb-3">
            <TextField
              label={t('recipe.method')}
              value={s.note}
              multiline
              onSave={(note) => saveSteps(steps.map((x) => (x.step_index === s.step_index ? { ...x, note } : x)))}
            />
          </div>
          <RowList>
            {r.lines
              .filter((l) => l.step_index === s.step_index)
              .sort((a, b) => a.position - b.position)
              .map((l) => (
                <LineCard
                  key={l.id}
                  line={l}
                  identify={identify}
                  onChange={(patch) => change(l.id, patch)}
                  onRemove={() => saveLines(r.lines.filter((x) => x.id !== l.id))}
                />
              ))}
            <AddLine onAdd={(name) => void addLine(s.step_index, s.type, name)} />
          </RowList>
          {r.steps.length > 0 && (
            <Button variant="ghost" className="mt-2 text-muted-foreground" onClick={() => void removeStep(s.step_index)}>
              <Trash2 />
              {t('recipe.removeStep')}
            </Button>
          )}
        </Section>
      ))}

      <Section title={t('recipe.addStep')}>
        <Chips>
          {STEP_TYPES.filter((type) => type !== 'ferment' || steps.length === 0).map((type) => (
            <Chip key={type} onClick={() => void saveSteps([...steps, { step_index: nextIndex, type, note: null }])}>
              {stepTypeLabel(type)}
            </Chip>
          ))}
        </Chips>
      </Section>

      <Calculator recipe={r} />

      <Section>
        <TextField label={t('recipe.notes')} value={r.notes_md} multiline onSave={(notes_md) => save({ notes_md: notes_md ?? '' }, { notes_md: r.notes_md })} />
      </Section>
    </Screen>
  );
}

function LineCard({
  line: l,
  identify,
  onChange,
  onRemove,
}: {
  line: RecipeLineView;
  identify: (name: string) => Pick<RecipeLineView, 'name' | 'kind' | 'variety_id' | 'catalog_id'> | null;
  onChange: (patch: Partial<RecipeLineView>) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  // "grams", or the base of a percentage.
  const amountMode = l.mode === 'percent' && l.base ? l.base : 'grams';
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 rounded-xl border bg-card p-3 md:grid-cols-[2fr_1fr_1.5fr_1fr_auto]">
      <div className="col-span-3 md:col-span-1">
        <TextField
          label={t('recipe.ingredient')}
          value={l.name}
          required
          list="recipe-names"
          onSave={(name) => onChange(identify(name!) ?? { name: name!, variety_id: null, catalog_id: null })}
        />
      </div>
      <label className="block">
        <span className="mb-1 block text-lg text-muted-foreground">{t('recipe.kind')}</span>
        <select
          className={selectClass}
          value={l.kind}
          onChange={(e) => void onChange({ kind: e.target.value as Kind, variety_id: null, catalog_id: null })}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="col-span-2 block md:col-span-1">
        <span className="mb-1 block text-lg text-muted-foreground">{t('recipe.amountIn')}</span>
        <select
          className={selectClass}
          value={amountMode}
          onChange={(e) => {
            const v = e.target.value;
            void onChange(
              v === 'grams'
                ? { mode: 'grams' }
                : { mode: 'percent', base: v as Base, percent: l.percent ?? 0, solve_for_heat: false },
            );
          }}
        >
          <option value="grams">{t('recipe.grams')}</option>
          {BASES.map((b) => (
            <option key={b} value={b}>
              {t('recipe.percentOfBase', { base: baseLabel(b) })}
            </option>
          ))}
        </select>
      </label>
      {l.solve_for_heat ? (
        <p className="col-span-2 flex h-14 items-center text-lg text-muted-foreground md:col-span-1">{t('recipe.solved')}</p>
      ) : (
        <div className="col-span-2 md:col-span-1">
          {l.mode === 'grams' ? (
            <NumberField label={t('recipe.grams')} value={l.grams} onSave={(grams) => onChange({ grams })} />
          ) : (
            <NumberField label={t('recipe.percent')} value={l.percent} required onSave={(percent) => onChange({ percent })} />
          )}
        </div>
      )}
      <Button variant="outline" size="icon" aria-label={t('recipe.removeLine', { name: l.name })} onClick={() => void onRemove()}>
        <Trash2 />
      </Button>
      {l.mode === 'grams' && (
        <label className="col-span-3 flex items-center gap-3 text-lg md:col-span-5">
          <input
            type="checkbox"
            className="size-6"
            checked={l.solve_for_heat}
            onChange={(e) => void onChange({ solve_for_heat: e.target.checked })}
          />
          {t('recipe.solveForHeat')}
        </label>
      )}
    </div>
  );
}

function AddLine({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    onAdd(name.trim());
    setName('');
  };
  return (
    <div className="flex gap-3">
      <Input
        placeholder={t('recipe.addIngredient')}
        aria-label={t('recipe.addIngredient')}
        list="recipe-names"
        value={name}
        enterKeyHint="done"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <Button variant="secondary" disabled={!name.trim()} onClick={add}>
        {t('recipe.add')}
      </Button>
    </div>
  );
}

function goalText(goal: NonNullable<Evaluation['goal']>, recipe: RecipeView, heat: Evaluation['heat']): string {
  const target = formatNumber(goal.target);
  if (goal.status === 'solved') {
    const name = recipe.lines.find((l) => l.id === goal.line_id)?.name ?? '';
    return t('recipe.goalSolved', { name, g: formatGrams(goal.grams), shu: target });
  }
  if (goal.status === 'no_solution') {
    const name = recipe.lines.find((l) => l.id === goal.line_id)?.name ?? '';
    return goal.range
      ? t('recipe.goalUnreachable', { name, shu: target, range: formatShuRange(goal.range.min, goal.range.max) })
      : t('recipe.goalNoHeat', { name, shu: target });
  }
  return heat ? t('recipe.goalEstimate', { shu: target }) : t('recipe.goalNoPeppers', { shu: target });
}

/** The recipe tried with the grams you have; nothing here is saved. */
function Calculator({ recipe }: { recipe: RecipeView }) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [mash, setMash] = useState('');
  const fixed = recipe.lines.filter((l) => l.mode === 'grams' && !l.solve_for_heat && l.kind !== 'mash');
  const needsMash = recipe.lines.some((l) => l.kind === 'mash' || (l.mode === 'percent' && (l.base === 'mash' || l.base === 'sauce')));
  const grams: Record<string, number> = {};
  for (const l of fixed) {
    const g = parseDecimal(typed[l.id] ?? '');
    if (g !== null) grams[l.id] = g;
  }
  const e = evaluateRecipe(recipe.lines, { grams, mash_g: parseDecimal(mash), heat_target_shu: recipe.heat_target_shu });
  const planned = new Map(e.lines.map((p) => [p.id, p]));

  return (
    <Section title={t('recipe.calculator')}>
      <div className="rounded-xl border bg-card p-3">
        {(fixed.length > 0 || needsMash) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {fixed.map((l) => (
              <label key={l.id} className="block">
                <span className="mb-1 block text-lg text-muted-foreground">{t('recipe.youHave', { name: l.name })}</span>
                <Input
                  inputMode="decimal"
                  placeholder={l.grams === null ? '' : formatNumber(l.grams)}
                  value={typed[l.id] ?? ''}
                  onChange={(ev) => setTyped((all) => ({ ...all, [l.id]: ev.target.value }))}
                />
              </label>
            ))}
            {needsMash && (
              <label className="block">
                <span className="mb-1 block text-lg text-muted-foreground">{t('recipe.mashWeighed')}</span>
                <Input inputMode="decimal" value={mash} onChange={(ev) => setMash(ev.target.value)} />
              </label>
            )}
          </div>
        )}
        <ul className="mt-3 divide-y">
          {recipe.lines.map((l) => {
            const p = planned.get(l.id);
            return (
              <li key={l.id} className="flex justify-between gap-4 py-2 text-lg">
                <span>
                  {l.name}
                  <span className="block text-base text-muted-foreground">{recipeLineText(l)}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {p?.grams != null ? formatGrams(p.grams) : p?.pending ? t('recipe.afterMash') : '—'}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 border-t pt-3 text-lg">
          {e.heat && (
            <p className="font-semibold">
              {t('recipe.heat', { range: formatShuRange(e.heat.low, e.heat.high) })}
              {e.heat.unknown.length > 0 && (
                <span className="block text-base font-normal text-muted-foreground">{t('recipe.heatUnknown', { names: e.heat.unknown.join(', ') })}</span>
              )}
            </p>
          )}
          {e.goal && <p className={e.goal.status === 'no_solution' ? 'font-semibold text-destructive' : ''}>{goalText(e.goal, recipe, e.heat)}</p>}
        </div>
      </div>
    </Section>
  );
}
