import { describe, expect, it } from 'vitest';
import type { Base } from './calc.ts';
import { evaluateRecipe, planInBatch, recipeFromBatch, recipeStepFor, type RecipeLine } from './recipe.ts';
import type { Kind, StepType } from './schemas.ts';

let n = 0;
function line(
  name: string,
  kind: Kind,
  amount: { g: number | null } | { pct: number; of: Base },
  extra: Partial<RecipeLine> = {},
): RecipeLine {
  n++;
  return {
    id: `l${n}`,
    step_index: 0,
    step_type: 'ferment',
    position: n,
    name,
    kind,
    ...('g' in amount
      ? { mode: 'grams', grams: amount.g, percent: null, base: null }
      : { mode: 'percent', grams: null, percent: amount.pct, base: amount.of }),
    solve_for_heat: false,
    shu_min: null,
    shu_max: null,
    ...extra,
  };
}

const blend = (l: RecipeLine): RecipeLine => ({ ...l, step_index: 1, step_type: 'blend' });
const grams = (lines: RecipeLine[], input = {}) => {
  const e = evaluateRecipe(lines, input);
  return Object.fromEntries(lines.map((l, i) => [l.name, e.lines[i]!.grams]));
};

describe('recipe evaluation (SPEC §7.3)', () => {
  // The SPEC example: garlic 5 % of peppers, salt 3 % of ferment_total, water 120 % of solids, xanthan 0.3 % of sauce.
  const recipe = () => [
    line('Habanero', 'pepper', { g: 600 }),
    line('Jalapeño', 'pepper', { g: 400 }),
    line('Salt', 'salt', { pct: 3, of: 'ferment_total' }),
    line('Water', 'water', { pct: 120, of: 'solids' }),
    line('Garlic', 'aromatic', { pct: 5, of: 'peppers' }),
    blend(line('Vinegar', 'acid', { pct: 10, of: 'mash' })),
    blend(line('Xanthan', 'thickener', { pct: 0.3, of: 'sauce' })),
  ];

  it('computes percent lines base by base, each base from the lines already computed', () => {
    // peppers 1000 → garlic 50 → solids 1050 → water 1260 → ferment_total 2310 → salt 69.3
    expect(grams(recipe())).toMatchObject({ Garlic: 50, Water: 1260, Salt: 69.3 });
  });

  it('never counts a line towards its own base', () => {
    const lines = [line('Pepper', 'pepper', { g: 1000 }), line('Carrot', 'vegetable', { pct: 10, of: 'solids' }), line('Onion', 'vegetable', { pct: 10, of: 'solids' })];
    // Both from solids without themselves or each other: 10 % of 1000.
    expect(grams(lines)).toMatchObject({ Carrot: 100, Onion: 100 });
  });

  it('keeps mash- and sauce-based lines pending until the mash is weighed', () => {
    const lines = recipe();
    const before = evaluateRecipe(lines);
    expect(before.lines.slice(-2)).toEqual([
      { id: lines[5]!.id, grams: null, pending: true },
      { id: lines[6]!.id, grams: null, pending: true },
    ]);
    // Mash 2000 → vinegar 200 → sauce 2200 without the xanthan → 6.6
    expect(grams(lines, { mash_g: 2000 })).toMatchObject({ Vinegar: 200, Xanthan: 6.6 });
    expect(evaluateRecipe(lines, { mash_g: 2000 }).lines.every((l) => !l.pending)).toBe(true);
  });

  it('scales with the pepper grams entered', () => {
    const lines = recipe();
    expect(grams(lines, { grams: { [lines[0]!.id]: 300, [lines[1]!.id]: 200 } })).toMatchObject({ Garlic: 25, Water: 630 });
  });

  it('estimates heat against a target when no line is marked to solve', () => {
    const lines = [line('Habanero', 'pepper', { g: 100 }, { shu_min: 100_000, shu_max: 300_000 }), line('Carrot', 'vegetable', { g: 900 })];
    const e = evaluateRecipe(lines, { heat_target_shu: 10_000 });
    expect(e.heat).toEqual({ low: 10_000, high: 30_000, unknown: [] });
    expect(e.goal).toEqual({ status: 'estimate', target: 10_000 });
  });

  it('solves the marked line for the heat target, recomputing the percent lines each time', () => {
    const lines = [
      line('Habanero', 'pepper', { g: null }, { shu_min: 200_000, shu_max: 200_000, solve_for_heat: true }),
      line('Bell pepper', 'pepper', { g: 1000 }, { shu_min: 0, shu_max: 0 }),
      line('Garlic', 'aromatic', { pct: 5, of: 'peppers' }),
      line('Water', 'water', { pct: 100, of: 'solids' }),
    ];
    const e = evaluateRecipe(lines, { heat_target_shu: 10_000 });
    expect(e.goal).toMatchObject({ status: 'solved', line_id: lines[0]!.id });
    // 200 000 h / ((1000 + h) × 1.05) = 10 000 → h = 10 500 / 189.5
    const h = 10_500 / 189.5;
    expect(e.lines[0]!.grams).toBeCloseTo(h, 1);
    expect((e.heat!.low + e.heat!.high) / 2).toBeCloseTo(10_000, -1);
    expect(e.lines[2]!.grams).toBeCloseTo((1000 + h) * 0.05, 1);
  });

  it('solves a mild line that brings the heat down', () => {
    const lines = [
      line('Habanero', 'pepper', { g: 100 }, { shu_min: 100_000, shu_max: 100_000 }),
      line('Carrot', 'vegetable', { g: null }, { solve_for_heat: true }),
    ];
    const e = evaluateRecipe(lines, { heat_target_shu: 20_000 });
    expect(e.goal).toEqual({ status: 'solved', target: 20_000, line_id: lines[1]!.id, grams: 400 });
  });

  it('says so when no non-negative amount reaches the target', () => {
    const lines = [
      line('Jalapeño', 'pepper', { g: 1000 }, { shu_min: 5000, shu_max: 5000 }),
      line('Habanero', 'pepper', { g: null }, { shu_min: 200_000, shu_max: 200_000, solve_for_heat: true }),
    ];
    // Less heat than jalapeño alone would need a negative habanero.
    const low = evaluateRecipe(lines, { heat_target_shu: 1000 });
    expect(low.goal).toMatchObject({ status: 'no_solution', range: { min: 5000 } });
    expect(low.goal?.status === 'no_solution' && low.goal.range!.max).toBeCloseTo(200_000, -2);
    // Hotter than habanero itself can't be reached at all.
    expect(evaluateRecipe(lines, { heat_target_shu: 300_000 }).goal?.status).toBe('no_solution');
    // The line isn't clamped to a made-up amount.
    expect(low.lines[1]!.grams).toBeNull();
  });

  it('leaves the solve line to the user when they enter its grams', () => {
    const lines = [line('Habanero', 'pepper', { g: null }, { shu_min: 100_000, shu_max: 100_000, solve_for_heat: true }), line('Carrot', 'vegetable', { g: 900 })];
    const e = evaluateRecipe(lines, { heat_target_shu: 20_000, grams: { [lines[0]!.id]: 100 } });
    expect(e.goal).toEqual({ status: 'estimate', target: 20_000 });
    expect(e.lines[0]!.grams).toBe(100);
  });
});

describe('planning a recipe line within a batch', () => {
  const step = (type: StepType, position: number, lines: [string, Kind, number][]) => ({
    type,
    position,
    date: null,
    lines: lines.map(([name, kind, grams]) => ({ name, kind, grams, shu_min: null, shu_max: null })),
  });

  it('uses the weighed lines and waits for the mash', () => {
    const ferment = step('ferment', 0, [['Habanero', 'pepper', 500]]);
    const xanthan = { mode: 'percent' as const, grams: null, percent: 0.5, base: 'sauce' as const, kind: 'thickener' as const };
    expect(planInBatch(xanthan, [ferment, step('blend', 1, [])])).toBeNull();
    expect(planInBatch(xanthan, [ferment, step('blend', 1, [['Mash', 'mash', 1800], ['Vinegar', 'acid', 200]])])).toBe(10);
    expect(planInBatch({ mode: 'percent', grams: null, percent: 5, base: 'peppers', kind: 'aromatic' }, [ferment])).toBe(25);
  });

  it('matches the n-th batch step of a type to the n-th recipe step of that type', () => {
    const recipe = [
      { step_index: 0, step_type: 'ferment' as const },
      { step_index: 1, step_type: 'blend' as const },
      { step_index: 2, step_type: 'cook' as const },
      { step_index: 3, step_type: 'blend' as const },
    ];
    const batch = [
      { id: 'f', type: 'ferment' as const, position: 0 },
      { id: 'b1', type: 'blend' as const, position: 1 },
      { id: 'b2', type: 'blend' as const, position: 3 },
      { id: 's', type: 'strain' as const, position: 2 },
    ];
    expect(recipeStepFor(recipe, batch, 'b1')).toBe(1);
    expect(recipeStepFor(recipe, batch, 'b2')).toBe(3);
    expect(recipeStepFor(recipe, batch, 's')).toBeNull();
  });
});

describe('save batch as recipe (SPEC §7.3)', () => {
  const add = (name: string, kind: Kind, grams: number | null) => ({ name, kind, grams, variety_id: null, catalog_id: null });
  const batch = [
    { type: 'ferment' as const, position: 0, lines: [add('Habanero', 'pepper', 400), add('Garlic', 'aromatic', 20), add('Water', 'water', 500), add('Salt', 'salt', 27.6)] },
    { type: 'blend' as const, position: 1, lines: [add('Mash', 'mash', 900), add('Vinegar', 'acid', 90), add('Xanthan', 'thickener', 2.97)] },
    { type: 'rest' as const, position: 2, lines: [] },
  ];

  it('keeps pepper grams and turns the rest into percentages of their bases', () => {
    const draft = recipeFromBatch(batch);
    expect(draft.map((l) => [l.step_index, l.name, l.mode, l.grams ?? l.percent, l.base])).toEqual([
      [0, 'Habanero', 'grams', 400, null],
      [0, 'Garlic', 'percent', 5, 'peppers'],
      [0, 'Water', 'percent', 125, 'peppers'],
      [0, 'Salt', 'percent', 3, 'ferment_total'],
      [1, 'Vinegar', 'percent', 10, 'mash'],
      [1, 'Xanthan', 'percent', 0.3, 'sauce'],
    ]);
  });

  it('gives back the batch when evaluated with the same peppers and mash', () => {
    const draft = recipeFromBatch(batch).map((l, i) => ({ ...l, id: `r${i}`, shu_min: null, shu_max: null }));
    expect(grams(draft, { mash_g: 900 })).toEqual({ Habanero: 400, Garlic: 20, Water: 500, Salt: 27.6, Vinegar: 90, Xanthan: 3 });
  });
});
