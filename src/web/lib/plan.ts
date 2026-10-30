// Planned amounts in a batch started from a recipe (SPEC §7.3). Each batch
// line from the recipe is matched to its recipe line; the plan follows what
// has actually been weighed so far, so the salt follows the vegetables you
// really put in; lines not weighed yet count with their own plan. A line's
// plan is snapshotted into planned_g when it is weighed.
import { bases, type CalcStep } from '../../shared/calc.ts';
import { fold } from '../../shared/names.ts';
import { evaluateRecipe, planInBatch, recipeStepFor } from '../../shared/recipe.ts';
import { recipeLineText } from './recipes.ts';
import type { BatchView, LineView, RecipeLineView, RecipeView, StepView } from './types.ts';

/** The batch as the calculations see it, optionally without one line. */
export function calcSteps(steps: StepView[], without?: string): CalcStep[] {
  return steps.map((s) => ({
    type: s.type,
    position: s.position,
    date: s.date,
    lines: s.lines
      .filter((l) => l.id !== without)
      .map((l) => ({ name: l.name, kind: l.kind, grams: l.grams, shu_min: l.shu?.min ?? null, shu_max: l.shu?.max ?? null })),
  }));
}

/** As calcSteps, with the planned grams standing in for lines not weighed yet. */
function planSteps(steps: StepView[], without?: string): CalcStep[] {
  return calcSteps(steps.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, grams: l.grams ?? l.planned_g })) })), without);
}

/** The recipe lines a batch step follows. */
export function recipeLinesFor(recipe: RecipeView, batch: BatchView, stepId: string): RecipeLineView[] {
  const index = recipeStepFor(recipe.steps, batch.steps, stepId);
  return index === null ? [] : recipe.lines.filter((l) => l.step_index === index);
}

const sameEntry = (a: Pick<LineView, 'name' | 'kind' | 'variety_id' | 'catalog_id'>, r: RecipeLineView) =>
  (a.variety_id !== null && a.variety_id === r.variety_id) ||
  (a.catalog_id !== null && a.catalog_id === r.catalog_id) ||
  (a.kind === r.kind && fold(a.name) === fold(r.name));

function recipeLineOf(recipe: RecipeView, batch: BatchView, step: StepView, line: LineView): RecipeLineView | undefined {
  return recipeLinesFor(recipe, batch, step.id).find((r) => sameEntry(line, r));
}

export interface Plan {
  grams: number | null;
  /** Waits for the mash to be weighed. */
  pending: boolean;
  /** The recipe's rule, "5 % of peppers", for when its base is still empty. */
  rule?: string;
  /** What to expect rather than what to aim for: the mash, which weighs what the ferment's solids did. */
  estimate?: boolean;
}

/** The plan for a line: live from the recipe when there is one, else the snapshot. */
export function planFor(line: LineView, step: StepView, batch: BatchView, recipe: RecipeView | undefined): Plan | null {
  if (line.kind === 'mash' && line.planned_g === null) {
    const solids = bases(calcSteps(batch.steps)).solids;
    return solids > 0 ? { grams: Math.round(solids), pending: false, estimate: true } : null;
  }
  const r = recipe && recipeLineOf(recipe, batch, step, line);
  if (!r) return line.planned_g === null ? null : { grams: line.planned_g, pending: false };
  if (r.kind === 'mash') return null;
  if (r.solve_for_heat && r.mode === 'grams' && recipe.heat_target_shu !== null) {
    // The heat goal is solved with the grams weighed so far standing in for the recipe's.
    const ferment = batch.steps.find((s) => s.type === 'ferment');
    const weighed: Record<string, number> = {};
    for (const l of ferment?.lines ?? []) {
      const match = recipe.lines.find((x) => x.mode === 'grams' && x.id !== r.id && sameEntry(l, x));
      if (match && l.grams !== null) weighed[match.id] = l.grams;
    }
    const goal = evaluateRecipe(recipe.lines, { grams: weighed, heat_target_shu: recipe.heat_target_shu }).goal;
    return { grams: goal?.status === 'solved' ? goal.grams : null, pending: false };
  }
  // Lines still to weigh count with their own plan, so garlic has one before the peppers are in.
  const grams = planInBatch(r, planSteps(batch.steps, line.id));
  const pending = grams === null && r.mode === 'percent' && (r.base === 'mash' || r.base === 'sauce');
  // Nothing weighed towards its base yet: 0 g would read as "leave it out".
  if (r.mode === 'percent' && !grams) return { grams: null, pending, rule: recipeLineText(r) };
  return { grams, pending };
}

/** The lines a new batch step gets from its recipe step, not yet weighed. */
export function linesForNewStep(recipe: RecipeView, batch: BatchView, stepId: string, mashName: string) {
  const lines = recipeLinesFor(recipe, batch, stepId);
  const waitsForMash = lines.some((l) => l.mode === 'percent' && (l.base === 'mash' || l.base === 'sauce'));
  const hasMash = lines.some((l) => l.kind === 'mash') || batch.steps.some((s) => s.lines.some((l) => l.kind === 'mash' && l.grams));
  return [
    ...(waitsForMash && !hasMash ? [{ name: mashName, kind: 'mash' as const, variety_id: null, catalog_id: null }] : []),
    ...lines.map((l) => ({ name: l.name, kind: l.kind, variety_id: l.variety_id, catalog_id: l.catalog_id })),
  ];
}
