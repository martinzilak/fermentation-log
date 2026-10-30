import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-support.ts';

let t: ReturnType<typeof testApp>;
beforeEach(() => {
  t = testApp();
});
afterEach(() => t.cleanup());

const id = () => randomUUID();

async function newBatch(extra: Record<string, unknown> = {}) {
  const res = await t.call('POST', '/api/batches', { id: id(), ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

async function addStep(batchId: string, body: Record<string, unknown>) {
  const res = await t.call('POST', `/api/batches/${batchId}/steps`, { id: id(), ...body });
  expect(res.status).toBe(201);
  return res.body;
}

describe('batches', () => {
  it('numbers new batches after the highest existing number', async () => {
    expect((await newBatch()).number).toBe(1);
    expect((await newBatch({ number: 7 })).number).toBe(7);
    expect((await newBatch()).number).toBe(8);
    const list = await t.call('GET', '/api/batches');
    expect(list.body.map((b: { number: number }) => b.number)).toEqual([8, 7, 1]);
  });

  it('returns the existing record when a POST id repeats', async () => {
    const batchId = id();
    const first = await t.call('POST', '/api/batches', { id: batchId, name: 'Harvest' });
    const again = await t.call('POST', '/api/batches', { id: batchId, name: 'Changed' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.name).toBe('Harvest');
    expect(t.db.prepare('SELECT COUNT(*) FROM batches').pluck().get()).toBe(1);
  });

  it('records the author and timestamps', async () => {
    const batch = await newBatch();
    expect(batch.author).toBe('cook@example.com');
    expect(batch.created_at).toBe('2026-10-29T10:00:00.000Z');
  });

  it('rejects a duplicate batch number with 409', async () => {
    await newBatch({ number: 3 });
    const res = await t.call('POST', '/api/batches', { id: id(), number: 3 });
    expect(res.status).toBe(409);
  });

  it('returns 400 with issues for an invalid body and 404 for an unknown batch', async () => {
    const bad = await t.call('POST', '/api/batches', { id: 'not-a-uuid' });
    expect(bad.status).toBe(400);
    expect(bad.body.issues[0].path).toBe('id');
    expect((await t.call('GET', `/api/batches/${id()}`)).status).toBe(404);
  });
});

describe('deleting a batch', () => {
  it('hides it from the list and the next number but keeps its rows, and is idempotent', async () => {
    await newBatch();
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment', date: '2026-10-20' });
    await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name: 'Habanero', kind: 'pepper', grams: 500 });
    expect((await t.call('DELETE', `/api/batches/${batch.id}`)).status).toBe(204);
    expect((await t.call('DELETE', `/api/batches/${batch.id}`)).status).toBe(204);
    expect((await t.call('GET', `/api/batches/${batch.id}`)).status).toBe(404);
    expect((await t.call('GET', '/api/batches')).body.map((b: { number: number }) => b.number)).toEqual([1]);
    expect((await t.call('GET', '/api/lines/recent')).body).toEqual([]);
    expect(t.db.prepare('SELECT COUNT(*) FROM ingredient_lines').pluck().get()).toBe(1);
    expect((await newBatch()).number).toBe(2);
  });

  it('restores a deleted batch unless its number was taken again', async () => {
    const batch = await newBatch();
    await t.call('DELETE', `/api/batches/${batch.id}`);
    const restored = await t.call('POST', `/api/batches/${batch.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.number).toBe(1);
    expect((await t.call('GET', '/api/batches')).body).toHaveLength(1);

    await t.call('DELETE', `/api/batches/${batch.id}`);
    await newBatch();
    expect((await t.call('POST', `/api/batches/${batch.id}/restore`)).status).toBe(409);
  });

  it('refuses to delete a bottled batch', async () => {
    const batch = await newBatch();
    await addStep(batch.id, { type: 'ferment', date: '2026-10-01' });
    await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'bottled', payload: { fills: [] } });
    expect((await t.call('DELETE', `/api/batches/${batch.id}`)).status).toBe(409);
    expect((await t.call('GET', `/api/batches/${batch.id}`)).status).toBe(200);
  });

  it('takes no new steps or events once deleted', async () => {
    const batch = await newBatch();
    await t.call('DELETE', `/api/batches/${batch.id}`);
    expect((await t.call('POST', `/api/batches/${batch.id}/steps`, { id: id(), type: 'ferment' })).status).toBe(404);
    expect((await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'note', text: 'x' })).status).toBe(404);
  });
});

describe('status transitions', () => {
  it('follows steps and the bottled event, and respects a manual override', async () => {
    const batch = await newBatch();
    const status = async () => (await t.call('GET', `/api/batches/${batch.id}`)).body.status;

    expect(await status()).toBe('planned');
    await addStep(batch.id, { type: 'ferment', date: '2026-10-01', params: { vessel_tare_g: 1669 } });
    expect(await status()).toBe('fermenting');
    const blend = await addStep(batch.id, { type: 'blend' });
    t.setNow('2026-10-29T13:00:00.000Z');
    expect(await status()).toBe('fermenting');
    await t.call('PATCH', `/api/steps/${blend.id}`, { date: '2026-10-20' });
    expect(await status()).toBe('processing');

    await t.call('PATCH', `/api/batches/${batch.id}`, { status: 'archived' });
    await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'bottled', payload: { fills: [] } });
    expect(await status()).toBe('archived');

    const reset = await t.call('PATCH', `/api/batches/${batch.id}`, { status: null });
    expect(reset.body.status).toBe('bottled');
    expect(reset.body.status_manual).toBe(false);
  });

  it('counts ferment days on the list while fermenting', async () => {
    const batch = await newBatch();
    await addStep(batch.id, { type: 'ferment', date: '2026-10-22' });
    const [row] = (await t.call('GET', '/api/batches')).body;
    expect(row.ferment_date).toBe('2026-10-22');
    expect(row.ferment_day).toBe(7);
  });
});

describe('steps and lines', () => {
  it('validates params by step type', async () => {
    const batch = await newBatch();
    const res = await t.call('POST', `/api/batches/${batch.id}/steps`, {
      id: id(),
      type: 'cook',
      params: { minutes: -1 },
    });
    expect(res.status).toBe(400);
    expect(res.body.issues[0].path).toBe('params.minutes');
  });

  it('appends lines in order and derives salt % on the batch', async () => {
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment', date: '2026-10-01' });
    for (const [name, kind, grams] of [
      ['Habanero', 'pepper', 500],
      ['Voda', 'water', 500],
      ['Soľ', 'salt', 30],
    ] as const) {
      const res = await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name, kind, grams });
      expect(res.status).toBe(201);
    }
    const view = (await t.call('GET', `/api/batches/${batch.id}`)).body;
    expect(view.steps[0].lines.map((l: { position: number }) => l.position)).toEqual([0, 1, 2]);
    expect(view.derived.salt_pct).toBe(3);
    expect(view.derived.suggested_salt_g).toBe(30);
  });

  it('clears a nullable field with PATCH null and deletes idempotently', async () => {
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment' });
    const line = (await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name: 'Mrkva', kind: 'vegetable', grams: 200 })).body;
    expect((await t.call('PATCH', `/api/lines/${line.id}`, { grams: null })).body.grams).toBeNull();
    expect((await t.call('DELETE', `/api/lines/${line.id}`)).status).toBe(204);
    expect((await t.call('DELETE', `/api/lines/${line.id}`)).status).toBe(204);
  });

  it('refuses a lot id that does not exist', async () => {
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment' });
    const res = await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name: 'X', kind: 'pepper', lot_id: id() });
    expect(res.status).toBe(400);
  });
});

describe('recent ingredient names', () => {
  it('lists each entry once, latest use first', async () => {
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment', date: '2026-10-20' });
    const add = async (name: string, kind: string) => {
      await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name, kind, grams: 10 });
    };
    await add('Cesnak', 'aromatic');
    t.setNow('2026-10-29T11:00:00.000Z');
    await add('Voda', 'water');
    t.setNow('2026-10-29T12:00:00.000Z');
    await add('garlic', 'aromatic');
    const blend = await addStep(batch.id, { type: 'blend' });
    t.setNow('2026-10-29T13:00:00.000Z');
    await t.call('POST', `/api/steps/${blend.id}/lines`, { id: id(), name: 'Garlic', kind: 'aromatic', grams: 5 });
    const res = await t.call('GET', '/api/lines/recent');
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(['Garlic', 'Water']);
    expect(res.body[0].step_types.sort()).toEqual(['blend', 'ferment']);
    expect(res.body[1].step_types).toEqual(['ferment']);
  });
});

describe('normalized ingredient lines', () => {
  async function ferment() {
    const batch = await newBatch();
    return addStep(batch.id, { type: 'ferment', date: '2026-10-20' });
  }
  const post = (stepId: string, body: Record<string, unknown>) =>
    t.call('POST', `/api/steps/${stepId}/lines`, { id: id(), grams: 10, ...body });

  it('resolves a name through aliases, ignoring case and accents, to the entry and its kind', async () => {
    const step = await ferment();
    const line = (await post(step.id, { name: 'SOL', kind: 'other' })).body;
    expect(line).toMatchObject({ name: 'Salt', kind: 'salt', variety_id: null });
    expect(line.catalog_id).toBe(t.db.prepare("SELECT id FROM catalog_items WHERE name = 'Salt'").pluck().get());
  });

  it('creates an entry for a new name, tidied, and reuses it', async () => {
    const step = await ferment();
    const first = (await post(step.id, { name: '  red   currant ', kind: 'fruit' })).body;
    const again = (await post(step.id, { name: 'Red Currant', kind: 'fruit' })).body;
    expect(first.name).toBe('Red currant');
    expect(again.catalog_id).toBe(first.catalog_id);
    const pepper = (await post(step.id, { name: 'aji charapita', kind: 'pepper' })).body;
    expect(pepper).toMatchObject({ name: 'Aji charapita', catalog_id: null });
    expect(t.db.prepare('SELECT name FROM varieties WHERE id = ?').pluck().get(pepper.variety_id)).toBe('Aji charapita');
  });

  it('takes the variety from the lot and refuses a lot of another variety', async () => {
    const step = await ferment();
    const habanero = (await t.call('POST', '/api/varieties', { id: id(), name: 'Habanero' })).body;
    const other = (await t.call('POST', '/api/varieties', { id: id(), name: 'Cayenne' })).body;
    const lot = (await t.call('POST', '/api/lots', { id: id(), variety_id: habanero.id, season: 2026, origin: 'grown' })).body;
    const line = (await post(step.id, { name: 'whatever', kind: 'pepper', lot_id: lot.id })).body;
    expect(line).toMatchObject({ name: 'Habanero', variety_id: habanero.id, lot_id: lot.id });
    const bad = await post(step.id, { name: 'Cayenne', kind: 'pepper', variety_id: other.id, lot_id: lot.id });
    expect(bad.status).toBe(400);
    expect(bad.body.issues[0].path).toBe('lot_id');
  });

  it('moves a line to another entry on PATCH, and keeps it when only the grams change', async () => {
    const step = await ferment();
    const line = (await post(step.id, { name: 'Voda', kind: 'water' })).body;
    const grams = (await t.call('PATCH', `/api/lines/${line.id}`, { grams: 20 })).body;
    expect(grams).toMatchObject({ name: 'Water', catalog_id: line.catalog_id, grams: 20 });
    const moved = (await t.call('PATCH', `/api/lines/${line.id}`, { name: 'Brine', kind: 'brine' })).body;
    expect(moved).toMatchObject({ name: 'Brine', kind: 'brine', grams: 20 });
    expect(moved.catalog_id).not.toBe(line.catalog_id);
  });

  it('copies a renamed entry onto its lines and refuses a name another entry answers to', async () => {
    const step = await ferment();
    const line = (await post(step.id, { name: 'Cesnak', kind: 'aromatic' })).body;
    const renamed = await t.call('PATCH', `/api/catalog/${line.catalog_id}`, { name: 'Garlic cloves', kind: 'vegetable' });
    expect(renamed.status).toBe(200);
    expect(t.db.prepare('SELECT name, kind FROM ingredient_lines WHERE id = ?').get(line.id)).toEqual({
      name: 'Garlic cloves',
      kind: 'vegetable',
    });
    expect((await t.call('PATCH', `/api/catalog/${line.catalog_id}`, { name: 'voda' })).status).toBe(409);
    expect((await t.call('POST', '/api/catalog', { id: id(), name: 'Soľ', kind: 'salt' })).status).toBe(409);
    expect((await t.call('POST', '/api/catalog', { id: id(), name: 'Bell pepper', kind: 'pepper' })).status).toBe(400);
    const tidy = await t.call('PATCH', `/api/catalog/${line.catalog_id}`, { aliases: ['Cesnak', 'Česnak', 'garlic cloves', 'Cesnek'] });
    expect(tidy.body.aliases).toEqual(['Cesnak', 'Cesnek']);
  });
});

describe('events', () => {
  it('validates payloads by event type and computes net weight from the tare', async () => {
    const batch = await newBatch();
    await addStep(batch.id, { type: 'ferment', params: { vessel_tare_g: 1669 } });
    const bad = await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'ph', payload: { value: 3.5 } });
    expect(bad.status).toBe(400);
    const weigh = await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'weigh', payload: { gross_g: 4200 } });
    expect(weigh.status).toBe(201);
    expect(weigh.body.occurred_at).toBe('2026-10-29T10:00:00.000Z');
    const view = (await t.call('GET', `/api/batches/${batch.id}`)).body;
    expect(view.events[0].net_g).toBe(2531);
  });

  it('refuses a step from another batch', async () => {
    const a = await newBatch();
    const b = await newBatch();
    const step = await addStep(b.id, { type: 'ferment' });
    const res = await t.call('POST', `/api/batches/${a.id}/events`, { id: id(), type: 'note', step_id: step.id, text: 'x' });
    expect(res.status).toBe(400);
  });

  it('lists the timeline newest first', async () => {
    const batch = await newBatch();
    for (const at of ['2026-10-02T08:00:00Z', '2026-10-05T08:00:00Z', '2026-10-03T08:00:00Z']) {
      await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'burp', occurred_at: at });
    }
    const view = (await t.call('GET', `/api/batches/${batch.id}`)).body;
    expect(view.events.map((e: { occurred_at: string }) => e.occurred_at.slice(0, 10))).toEqual([
      '2026-10-05',
      '2026-10-03',
      '2026-10-02',
    ]);
  });
});

describe('merging and deleting entries', () => {
  async function lineIn(name: string, kind: string, extra: Record<string, unknown> = {}) {
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment' });
    return (await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name, kind, grams: 10, ...extra })).body;
  }

  it('moves the lines of a merged catalog item and keeps its names as aliases', async () => {
    const typo = await lineIn('Garlik', 'aromatic');
    const garlic = t.db.prepare("SELECT id FROM catalog_items WHERE name = 'Garlic'").pluck().get() as string;
    const res = await t.call('POST', `/api/catalog/${typo.catalog_id}/merge`, { into: garlic });
    expect(res.status).toBe(200);
    expect(res.body.aliases).toEqual(['Cesnak', 'Garlik']);
    expect(t.db.prepare('SELECT name, catalog_id FROM ingredient_lines WHERE id = ?').get(typo.id)).toEqual({ name: 'Garlic', catalog_id: garlic });
    expect(t.db.prepare('SELECT COUNT(*) FROM catalog_items WHERE id = ?').pluck().get(typo.catalog_id)).toBe(0);
  });

  it('moves the lots of a merged variety and takes its SHU when the kept one has none', async () => {
    const kept = (await t.call('POST', '/api/varieties', { id: id(), name: 'Habanero' })).body;
    const other = (await t.call('POST', '/api/varieties', { id: id(), name: 'Habanero Orange', shu_min: 100000, shu_max: 350000 })).body;
    const lot = (await t.call('POST', '/api/lots', { id: id(), variety_id: other.id, season: 2026, origin: 'grown' })).body;
    const line = await lineIn('Habanero Orange', 'pepper', { lot_id: lot.id });
    const merged = (await t.call('POST', `/api/varieties/${other.id}/merge`, { into: kept.id })).body;
    expect(merged).toMatchObject({ shu_min: 100000, shu_max: 350000, aliases: ['Habanero Orange'] });
    expect(t.db.prepare('SELECT variety_id FROM pepper_lots WHERE id = ?').pluck().get(lot.id)).toBe(kept.id);
    expect(t.db.prepare('SELECT name, variety_id FROM ingredient_lines WHERE id = ?').get(line.id)).toEqual({ name: 'Habanero', variety_id: kept.id });
  });

  it('counts uses and deletes only what is unused', async () => {
    const line = await lineIn('Garlik', 'aromatic');
    const item = (await t.call('GET', '/api/catalog')).body.find((c: { id: string }) => c.id === line.catalog_id);
    expect(item.uses).toBe(1);
    expect((await t.call('DELETE', `/api/catalog/${line.catalog_id}`)).status).toBe(409);
    await t.call('DELETE', `/api/lines/${line.id}`);
    expect((await t.call('DELETE', `/api/catalog/${line.catalog_id}`)).status).toBe(204);

    const bottle = (await t.call('POST', '/api/bottle-types', { id: id(), name: 'Woozy', volume_ml: 150 })).body;
    const batch = await newBatch();
    const fills = [{ bottle_type_id: bottle.id, count: 6 }, { volume_ml: 330, count: 1, label: 'Jam jar' }];
    const bottled = await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'bottled', payload: { fills } });
    expect(bottled.status).toBe(201);
    expect((await t.call('GET', `/api/batches/${batch.id}`)).body.derived.bottled_volume_ml).toBe(1230);
    expect((await t.call('GET', '/api/bottle-types')).body[0].uses).toBe(1);
    expect((await t.call('DELETE', `/api/bottle-types/${bottle.id}`)).status).toBe(409);
  });

  it('moves the lines of a lot given to another variety', async () => {
    const a = (await t.call('POST', '/api/varieties', { id: id(), name: 'Cayenne' })).body;
    const b = (await t.call('POST', '/api/varieties', { id: id(), name: 'Cayenne Long' })).body;
    const lot = (await t.call('POST', '/api/lots', { id: id(), variety_id: a.id, season: 2026, origin: 'bought' })).body;
    const line = await lineIn('x', 'pepper', { lot_id: lot.id });
    await t.call('PATCH', `/api/lots/${lot.id}`, { variety_id: b.id });
    expect(t.db.prepare('SELECT name, variety_id FROM ingredient_lines WHERE id = ?').get(line.id)).toEqual({ name: 'Cayenne Long', variety_id: b.id });
  });
});
