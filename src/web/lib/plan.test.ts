import { describe, expect, it } from 'vitest';
import type { RecipeLine } from '../../shared/recipe.ts';
import { linesForNewStep, planFor } from './plan.ts';
import type { BatchView, LineView, RecipeView, StepView } from './types.ts';

const rline = (id: string, name: string, kind: RecipeLine['kind'], amount: Partial<RecipeLine>, step = 0): RecipeView['lines'][number] => ({
  id,
  recipe_id: 'r',
  step_index: step,
  step_type: step === 0 ? 'ferment' : 'blend',
  position: 0,
  name,
  kind,
  mode: 'grams',
  grams: null,
  percent: null,
  base: null,
  solve_for_heat: false,
  shu_min: null,
  shu_max: null,
  variety_id: null,
  catalog_id: null,
  ...amount,
});

const recipe: RecipeView = {
  id: 'r',
  name: 'House',
  notes_md: '',
  heat_target_shu: 10_000,
  created_from_batch_id: null,
  created_at: '',
  updated_at: '',
  author: '',
  steps: [
    { step_index: 0, type: 'ferment', note: null },
    { step_index: 1, type: 'blend', note: null },
  ],
  lines: [
    rline('jal', 'Jalapeño', 'pepper', { grams: 900, shu_min: 0, shu_max: 0 }),
    rline('hab', 'Habanero', 'pepper', { solve_for_heat: true, shu_min: 200_000, shu_max: 200_000 }),
    rline('gar', 'Garlic', 'aromatic', { mode: 'percent', percent: 5, base: 'peppers' }),
    rline('xan', 'Xanthan', 'thickener', { mode: 'percent', percent: 0.5, base: 'sauce' }, 1),
  ],
};

const line = (id: string, name: string, kind: LineView['kind'], grams: number | null, shu?: number): LineView => ({
  id,
  step_id: 'f',
  position: 0,
  name,
  local_name: null,
  kind,
  grams,
  planned_g: null,
  lot_id: null,
  catalog_id: null,
  note: null,
  variety_id: null,
  variety_name: null,
  shu_min: null,
  shu_max: null,
  shu_source: null,
  shu: shu === undefined ? null : { min: shu, max: shu, source: null },
});

function batch(ferment: LineView[], blend?: LineView[]): BatchView {
  const steps: StepView[] = [{ id: 'f', type: 'ferment', position: 0, date: '2026-10-30', params: {}, note: null, lines: ferment }];
  if (blend) steps.push({ id: 'b', type: 'blend', position: 1, date: '2026-11-10', params: {}, note: null, lines: blend });
  return { id: 'x', number: 1, name: null, color: null, status: 'fermenting', status_manual: false, recipe_id: 'r', notes_md: '', steps, events: [], derived: {} as BatchView['derived'] };
}

describe('plans in a batch from a recipe (SPEC §7.3)', () => {
  it('follows what has been weighed, and shows the rule while the base is empty', () => {
    const garlic = line('g', 'Garlic', 'aromatic', null);
    const empty = batch([line('j', 'Jalapeño', 'pepper', null), garlic]);
    expect(planFor(garlic, empty.steps[0]!, empty, recipe)).toEqual({ grams: null, pending: false, rule: '5 % of peppers' });
    const weighed = batch([line('j', 'Jalapeño', 'pepper', 1000, 0), garlic]);
    expect(planFor(garlic, weighed.steps[0]!, weighed, recipe)).toEqual({ grams: 50, pending: false });
  });

  it('counts the peppers still to weigh with their plan', () => {
    const garlic = line('g', 'Garlic', 'aromatic', null);
    const planned = batch([{ ...line('j', 'Jalapeño', 'pepper', null), planned_g: 900 }, garlic]);
    expect(planFor(garlic, planned.steps[0]!, planned, recipe)).toEqual({ grams: 45, pending: false });
  });

  it('expects the mash to weigh what the ferment’s solids did', () => {
    const mash = line('m', 'Mash', 'mash', null);
    const b = batch([line('j', 'Jalapeño', 'pepper', 1000), line('g', 'Garlic', 'aromatic', 50), line('w', 'Water', 'water', 1000)], [mash]);
    expect(planFor(mash, b.steps[1]!, b, recipe)).toEqual({ grams: 1050, pending: false, estimate: true });
  });

  it('solves the heat line from the peppers actually weighed', () => {
    const hab = line('h', 'Habanero', 'pepper', null);
    const b = batch([line('j', 'Jalapeño', 'pepper', 1000, 0), hab, line('g', 'Garlic', 'aromatic', null)]);
    // 200 000 h / ((1000 + h) × 1.05) = 10 000
    expect(planFor(hab, b.steps[0]!, b, recipe)!.grams).toBeCloseTo(10_500 / 189.5, 1);
  });

  it('gives a new blend step its recipe lines, with the mash to weigh first', () => {
    const b = batch([line('j', 'Jalapeño', 'pepper', 1000)], []);
    expect(linesForNewStep(recipe, b, 'b', 'Mash').map((l) => l.name)).toEqual(['Mash', 'Xanthan']);
    const xan = line('xx', 'Xanthan', 'thickener', null);
    const waiting = batch([], [xan]);
    expect(planFor(xan, waiting.steps[1]!, waiting, recipe)).toMatchObject({ grams: null, pending: true });
    const mashed = batch([], [line('m', 'Mash', 'mash', 1200), xan]);
    expect(planFor(xan, mashed.steps[1]!, mashed, recipe)).toEqual({ grams: 6, pending: false });
  });

  it('falls back to the snapshot for a line the recipe doesn’t have', () => {
    const other = { ...line('o', 'Onion', 'vegetable', null), planned_g: 80 };
    const b = batch([other]);
    expect(planFor(other, b.steps[0]!, b, recipe)).toEqual({ grams: 80, pending: false });
  });
});
