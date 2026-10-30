// Recipes with goals (SPEC §7.3). A recipe fixes some amounts in grams and
// the rest as baker's percentages of a base; evaluating it computes the grams
// of every line, and can solve one line's grams for a heat target. Shared so
// the client calculates live and the server answers /evaluate the same way.
import { bases, heatEstimate, type Base, type CalcLine, type CalcStep, type HeatEstimate } from './calc.ts';
import type { Kind, StepType } from './schemas.ts';

/** The order percent lines are computed in; a base only sums lines computed before it. */
export const BASE_ORDER: readonly Base[] = ['peppers', 'solids', 'ferment_total', 'mash', 'sauce'];

export interface RecipeLine {
  id: string;
  step_index: number;
  step_type: StepType;
  position: number;
  name: string;
  kind: Kind;
  mode: 'grams' | 'percent' | 'remainder';
  grams: number | null;
  percent: number | null;
  base: Base | null;
  solve_for_heat: boolean;
  /** The variety's SHU, for the heat estimate. */
  shu_min: number | null;
  shu_max: number | null;
}

export interface EvaluateInput {
  /** Grams to use instead of the recipe's for `grams` lines, by line id: the peppers you have. */
  grams?: Record<string, number> | undefined;
  /** The weighed mash. Mash- and sauce-based lines are pending without it. */
  mash_g?: number | null | undefined;
  heat_target_shu?: number | null | undefined;
}

export interface PlannedLine {
  id: string;
  /** null when it can't be computed yet (pending) or has no amount. */
  grams: number | null;
  /** Waits for the mash to be weighed. */
  pending: boolean;
}

export type HeatGoal =
  /** No line to solve: the estimate is shown against the target. */
  | { status: 'estimate'; target: number }
  | { status: 'solved'; target: number; line_id: string; grams: number }
  /** No non-negative amount of the line reaches the target; `range` is what it can reach. */
  | { status: 'no_solution'; target: number; line_id: string; range: { min: number; max: number } | null };

export interface Evaluation {
  lines: PlannedLine[];
  bases: Record<Base, number>;
  heat: HeatEstimate | null;
  goal: HeatGoal | null;
}

const isPendingBase = (base: Base | null) => base === 'mash' || base === 'sauce';

/** Recipe lines grouped into steps the batch calculations understand. */
function calcSteps(lines: RecipeLine[], amounts: Map<string, number | null>, mashG: number | null): CalcStep[] {
  const byIndex = new Map<number, CalcStep>();
  for (const l of [...lines].sort((a, b) => a.step_index - b.step_index || a.position - b.position)) {
    let step = byIndex.get(l.step_index);
    if (!step) byIndex.set(l.step_index, (step = { type: l.step_type, position: l.step_index, date: null, lines: [] }));
    // The weighed mash stands in for any mash line of the recipe.
    if (l.kind === 'mash') continue;
    step.lines.push({ name: l.name, kind: l.kind, grams: amounts.get(l.id) ?? null, shu_min: l.shu_min, shu_max: l.shu_max });
  }
  const steps = [...byIndex.values()].sort((a, b) => a.position - b.position);
  if (mashG !== null) {
    const mash: CalcLine = { name: 'Mash', kind: 'mash', grams: mashG, shu_min: null, shu_max: null };
    const ferment = steps.find((s) => s.type === 'ferment');
    const after = steps.find((s) => (ferment ? s.position > ferment.position : true) && s !== ferment);
    if (after) after.lines.unshift(mash);
    else steps.push({ type: 'blend', position: (steps.at(-1)?.position ?? 0) + 1, date: null, lines: [mash] });
  }
  return steps;
}

function compute(lines: RecipeLine[], grams: Record<string, number>, mashG: number | null) {
  const amounts = new Map<string, number | null>();
  const pending = new Set<string>();
  for (const l of lines) {
    if (l.kind === 'mash') {
      amounts.set(l.id, mashG);
      if (mashG === null) pending.add(l.id);
    } else if (l.mode === 'grams') amounts.set(l.id, grams[l.id] ?? l.grams);
  }
  for (const base of BASE_ORDER) {
    // Taken once per base, so lines on the same base don't count towards each other.
    const total = bases(calcSteps(lines, amounts, mashG))[base];
    for (const l of lines) {
      if (l.kind === 'mash' || l.mode !== 'percent' || l.base !== base) continue;
      if (isPendingBase(base) && mashG === null) {
        pending.add(l.id);
        amounts.set(l.id, null);
      } else amounts.set(l.id, l.percent === null ? null : (l.percent / 100) * total);
    }
  }
  const steps = calcSteps(lines, amounts, mashG);
  return { amounts, pending, steps, heat: heatEstimate(steps) };
}

const midpoint = (h: HeatEstimate | null) => (h ? (h.low + h.high) / 2 : NaN);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The grams of `line` whose heat midpoint meets `target`, by bisection over the whole recipe. */
function solveHeat(lines: RecipeLine[], line: RecipeLine, input: EvaluateInput, target: number): HeatGoal {
  const heatAt = (g: number) => midpoint(compute(lines, { ...input.grams, [line.id]: g }, input.mash_g ?? null).heat);
  // Heat is a ratio of sums that are linear in the line's grams, so it moves one way only:
  // the ends of a wide interval bound everything it can reach.
  let lo = 0;
  let hi = 10_000_000;
  let fLo = heatAt(lo);
  if (Number.isNaN(fLo)) fLo = heatAt((lo = 0.001));
  const fHi = heatAt(hi);
  if (Number.isNaN(fLo) || Number.isNaN(fHi)) return { status: 'no_solution', target, line_id: line.id, range: null };
  const range = { min: Math.min(fLo, fHi), max: Math.max(fLo, fHi) };
  const close = (f: number) => Math.abs(f - target) <= Math.max(1e-9, target * 1e-9);
  if (close(fLo)) return { status: 'solved', target, line_id: line.id, grams: round1(lo) };
  if (target < range.min || target > range.max) return { status: 'no_solution', target, line_id: line.id, range };
  const rising = fHi > fLo;
  for (let i = 0; i < 100 && hi - lo > 0.01; i++) {
    const mid = (lo + hi) / 2;
    if (heatAt(mid) < target === rising) lo = mid;
    else hi = mid;
  }
  return { status: 'solved', target, line_id: line.id, grams: round1((lo + hi) / 2) };
}

export function evaluateRecipe(lines: RecipeLine[], input: EvaluateInput = {}): Evaluation {
  const grams = { ...input.grams };
  const target = input.heat_target_shu ?? null;
  let goal: HeatGoal | null = null;
  if (target !== null) {
    const solve = lines.find((l) => l.solve_for_heat && l.mode === 'grams');
    // Grams entered for the solve line fix it; then there is nothing to solve.
    if (!solve || solve.id in grams) goal = { status: 'estimate', target };
    else {
      goal = solveHeat(lines, solve, input, target);
      if (goal.status === 'solved') grams[solve.id] = goal.grams;
    }
  }
  const { amounts, pending, steps, heat } = compute(lines, grams, input.mash_g ?? null);
  return {
    lines: lines.map((l) => {
      const g = amounts.get(l.id) ?? null;
      return { id: l.id, grams: g === null ? null : round1(g), pending: pending.has(l.id) };
    }),
    bases: bases(steps),
    heat,
    goal,
  };
}

/**
 * The planned grams of a recipe line within an actual batch, from the batch's
 * weighed lines. `steps` must leave out the line itself, which never counts
 * towards its own base.
 */
export function planInBatch(line: Pick<RecipeLine, 'mode' | 'grams' | 'percent' | 'base' | 'kind'>, steps: CalcStep[]): PlannedLine['grams'] {
  if (line.kind === 'mash') return null;
  if (line.mode === 'grams') return line.grams;
  if (line.mode !== 'percent' || line.percent === null || !line.base) return null;
  const b = bases(steps);
  if (isPendingBase(line.base) && b.mash <= 0) return null;
  return round1((line.percent / 100) * b[line.base]);
}

export interface BatchLineForRecipe {
  name: string;
  kind: Kind;
  grams: number | null;
  variety_id: string | null;
  catalog_id: string | null;
}

export interface RecipeStep {
  step_index: number;
  type: StepType;
  note: string | null;
}

export type DraftRecipeLine = Omit<RecipeLine, 'id' | 'shu_min' | 'shu_max' | 'mode'> & {
  mode: 'grams' | 'percent';
  variety_id: string | null;
  catalog_id: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "Save batch as recipe": peppers keep their grams, the other ferment lines
 * become percent of peppers and salt percent of ferment_total. After the
 * ferment, thickeners become percent of the sauce and other additions percent
 * of the mash; the mash itself is weighed, not added, so it is left out.
 * Every step is kept, with or without additions.
 */
export function recipeFromBatch(steps: { type: StepType; position: number; lines: BatchLineForRecipe[] }[]): {
  steps: RecipeStep[];
  lines: DraftRecipeLine[];
} {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const calc: CalcStep[] = ordered.map((s) => ({
    type: s.type,
    position: s.position,
    date: null,
    lines: s.lines.map((l) => ({ name: l.name, kind: l.kind, grams: l.grams, shu_min: null, shu_max: null })),
  }));
  const b = bases(calc);
  const ferment = ordered.find((s) => s.type === 'ferment');
  const out: DraftRecipeLine[] = [];
  ordered.forEach((step, index) => {
    const lines = step.lines.filter((l) => l.grams !== null && l.kind !== 'mash');
    const afterFerment = step !== ferment;
    lines.forEach((l, position) => {
      const g = l.grams!;
      const ofBase = (base: Base, total: number) =>
        total > 0 ? { mode: 'percent' as const, grams: null, percent: round2((g / total) * 100), base } : null;
      const amount =
        (!afterFerment && l.kind === 'pepper'
          ? null
          : !afterFerment && l.kind === 'salt'
            ? ofBase('ferment_total', b.ferment_total)
            : !afterFerment
              ? ofBase('peppers', b.peppers)
              : l.kind === 'thickener'
                ? ofBase('sauce', b.sauce - g)
                : ofBase('mash', b.mash)) ?? { mode: 'grams' as const, grams: g, percent: null, base: null };
      out.push({
        step_index: index,
        step_type: step.type,
        position,
        name: l.name,
        kind: l.kind,
        ...amount,
        solve_for_heat: false,
        variety_id: l.variety_id,
        catalog_id: l.catalog_id,
      });
    });
  });
  return { steps: ordered.map((s, step_index) => ({ step_index, type: s.type, note: null })), lines: out };
}

/**
 * The recipe step a batch step follows: the n-th step of a type in the batch
 * follows the n-th step of that type in the recipe.
 */
export function recipeStepFor(
  recipe: Pick<RecipeStep, 'step_index' | 'type'>[],
  batchSteps: { id: string; type: StepType; position: number }[],
  stepId: string,
): number | null {
  const step = batchSteps.find((s) => s.id === stepId);
  if (!step) return null;
  const n = batchSteps.filter((s) => s.type === step.type && s.position < step.position).length;
  const indexes = recipe.filter((s) => s.type === step.type).map((s) => s.step_index).sort((a, b) => a - b);
  return indexes[n] ?? null;
}

/** The first recipe step the batch has no step for yet, by the same matching. */
export function nextRecipeStep<S extends Pick<RecipeStep, 'step_index' | 'type'>>(
  recipe: S[],
  batchSteps: { type: StepType }[],
): S | null {
  const seen = new Map<StepType, number>();
  for (const s of [...recipe].sort((a, b) => a.step_index - b.step_index)) {
    const n = seen.get(s.type) ?? 0;
    seen.set(s.type, n + 1);
    if (batchSteps.filter((b) => b.type === s.type).length <= n) return s;
  }
  return null;
}
