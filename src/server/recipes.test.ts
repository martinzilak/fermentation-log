import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-support.ts';

let t: ReturnType<typeof testApp>;
beforeEach(() => {
  t = testApp();
});
afterEach(() => t.cleanup());

const id = () => randomUUID();

const line = (name: string, kind: string, amount: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: id(),
  step_index: 0,
  step_type: 'ferment',
  name,
  kind,
  ...amount,
  ...extra,
});

describe('recipes (SPEC §7.3)', () => {
  it('creates a recipe with its lines, linked to varieties and catalog items', async () => {
    const varietyId = id();
    await t.call('POST', '/api/varieties', { id: varietyId, name: 'Habanero', shu_min: 100_000, shu_max: 350_000 });
    const recipeId = id();
    const res = await t.call('POST', '/api/recipes', {
      id: recipeId,
      name: 'House red',
      heat_target_shu: 20_000,
      lines: [
        line('habanero', 'pepper', { mode: 'grams', grams: 500 }),
        line('Garlic', 'aromatic', { mode: 'percent', percent: 5, base: 'peppers' }),
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.lines.map((l: Record<string, unknown>) => [l.name, l.position, l.variety_id, l.shu_max])).toEqual([
      ['Habanero', 0, varietyId, 350_000],
      ['Garlic', 1, null, null],
    ]);
    expect(res.body.lines[1].catalog_id).toBeTruthy();
    expect((await t.call('POST', '/api/recipes', { id: recipeId, name: 'Again' })).status).toBe(200);
    expect((await t.call('GET', '/api/recipes')).body.filter((r: { id: string }) => r.id === recipeId).map((r: { name: string }) => r.name)).toEqual(['House red']);
  });

  it('replaces the lines on PATCH and keeps them otherwise', async () => {
    const recipeId = id();
    await t.call('POST', '/api/recipes', { id: recipeId, name: 'A', lines: [line('Jalapeño', 'pepper', { mode: 'grams', grams: 100 })] });
    expect((await t.call('PATCH', `/api/recipes/${recipeId}`, { name: 'B' })).body.lines).toHaveLength(1);
    const res = await t.call('PATCH', `/api/recipes/${recipeId}`, {
      lines: [line('Salt', 'salt', { mode: 'percent', percent: 3, base: 'ferment_total' })],
    });
    expect(res.body).toMatchObject({ name: 'B', lines: [{ name: 'Salt', percent: 3, base: 'ferment_total' }] });
  });

  it('keeps steps without lines and gives each line its step', async () => {
    const recipeId = id();
    const res = await t.call('POST', '/api/recipes', {
      id: recipeId,
      name: 'Stepped',
      steps: [
        { step_index: 0, type: 'ferment', note: 'Three weeks' },
        { step_index: 1, type: 'cook' },
        { step_index: 2, type: 'strain' },
      ],
      lines: [line('Jalapeño', 'pepper', { mode: 'grams', grams: 100 }), line('Vinegar', 'acid', { mode: 'grams', grams: 10 }, { step_index: 3, step_type: 'blend' })],
    });
    expect(res.body.steps).toEqual([
      { step_index: 0, type: 'ferment', note: 'Three weeks' },
      { step_index: 1, type: 'cook', note: null },
      { step_index: 2, type: 'strain', note: null },
      { step_index: 3, type: 'blend', note: null },
    ]);
    // A step changing type takes its lines along; lines alone keep the steps.
    const patched = await t.call('PATCH', `/api/recipes/${recipeId}`, {
      steps: [
        { step_index: 0, type: 'ferment' },
        { step_index: 3, type: 'cook', note: 'Simmer' },
      ],
    });
    expect(patched.body.steps.map((s: { type: string }) => s.type)).toEqual(['ferment', 'cook']);
    expect(patched.body.lines.map((l: { step_type: string }) => l.step_type)).toEqual(['ferment', 'cook']);
    const named = await t.call('PATCH', `/api/recipes/${recipeId}`, { name: 'Renamed' });
    expect(named.body.steps).toHaveLength(2);
    const bad = await t.call('PATCH', `/api/recipes/${recipeId}`, { steps: [{ step_index: 0, type: 'ferment' }, { step_index: 0, type: 'cook' }] });
    expect(bad.status).toBe(400);
  });

  it('rejects a percent line without a base, a second solve line and remainder lines', async () => {
    const bad = async (lines: unknown[]) => (await t.call('POST', '/api/recipes', { id: id(), name: 'X', lines })).status;
    expect(await bad([line('Garlic', 'aromatic', { mode: 'percent', percent: 5 })])).toBe(400);
    expect(await bad([line('Water', 'water', { mode: 'remainder' })])).toBe(400);
    const solve = { solve_for_heat: true };
    expect(
      await bad([line('A', 'pepper', { mode: 'grams', grams: 1 }, solve), line('B', 'pepper', { mode: 'grams', grams: 1 }, solve)]),
    ).toBe(400);
    expect(await bad([line('A', 'aromatic', { mode: 'percent', percent: 1, base: 'peppers' }, solve)])).toBe(400);
  });

  it('evaluates with the pepper grams entered and the weighed mash', async () => {
    const recipeId = id();
    const pepper = line('Jalapeño', 'pepper', { mode: 'grams', grams: 1000 });
    const xanthan = { ...line('Xanthan', 'thickener', { mode: 'percent', percent: 0.5, base: 'sauce' }), step_index: 1, step_type: 'blend' };
    await t.call('POST', '/api/recipes', {
      id: recipeId,
      name: 'R',
      lines: [pepper, line('Salt', 'salt', { mode: 'percent', percent: 2, base: 'ferment_total' }), xanthan],
    });
    const res = await t.call('POST', `/api/recipes/${recipeId}/evaluate`, { grams: { [pepper.id]: 500 } });
    expect(res.body.lines.map((l: { grams: number | null; pending: boolean }) => [l.grams, l.pending])).toEqual([
      [500, false],
      [10, false],
      [null, true],
    ]);
    const mashed = await t.call('POST', `/api/recipes/${recipeId}/evaluate`, { mash_g: 1000 });
    expect(mashed.body.lines[2]).toEqual({ id: xanthan.id, grams: 5, pending: false });
    expect((await t.call('POST', `/api/recipes/${id()}/evaluate`, {})).status).toBe(404);
  });

  it('saves a batch as a recipe', async () => {
    const batchId = id();
    await t.call('POST', '/api/batches', { id: batchId, number: 9 });
    const ferment = id();
    const blend = id();
    await t.call('POST', `/api/batches/${batchId}/steps`, { id: ferment, type: 'ferment', date: '2026-10-01' });
    for (const [name, kind, grams] of [['Habanero', 'pepper', 400], ['Garlic', 'aromatic', 40], ['Salt', 'salt', 13.2]] as const) {
      await t.call('POST', `/api/steps/${ferment}/lines`, { id: id(), name, kind, grams });
    }
    await t.call('POST', `/api/batches/${batchId}/steps`, { id: blend, type: 'blend', date: '2026-10-20' });
    await t.call('POST', `/api/steps/${blend}/lines`, { id: id(), name: 'Mash', kind: 'mash', grams: 420 });
    await t.call('POST', `/api/steps/${blend}/lines`, { id: id(), name: 'Vinegar', kind: 'acid', grams: 42 });
    await t.call('POST', `/api/batches/${batchId}/steps`, { id: id(), type: 'strain', date: '2026-10-21' });

    const recipeId = id();
    const res = await t.call('POST', `/api/batches/${batchId}/save-as-recipe`, { id: recipeId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Batch #9', created_from_batch_id: batchId });
    expect(res.body.lines.map((l: Record<string, unknown>) => [l.step_type, l.name, l.mode, l.grams ?? l.percent, l.base])).toEqual([
      ['ferment', 'Habanero', 'grams', 400, null],
      ['ferment', 'Garlic', 'percent', 10, 'peppers'],
      ['ferment', 'Salt', 'percent', 3, 'ferment_total'],
      ['blend', 'Vinegar', 'percent', 10, 'mash'],
    ]);
    expect(res.body.steps.map((s: { type: string }) => s.type)).toEqual(['ferment', 'blend', 'strain']);
    // Replaying the request, as the outbox may, creates nothing new.
    expect((await t.call('POST', `/api/batches/${batchId}/save-as-recipe`, { id: recipeId })).status).toBe(200);
    expect(t.db.prepare('SELECT COUNT(*) FROM recipes WHERE created_from_batch_id = ?').pluck().get(batchId)).toBe(1);
  });
});
