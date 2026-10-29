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

describe('reference data and settings', () => {
  it('creates, lists and patches bottle types', async () => {
    const bt = await t.call('POST', '/api/bottle-types', { id: id(), name: 'Woozy 150 ml', volume_ml: 150 });
    expect(bt.status).toBe(201);
    await t.call('PATCH', `/api/bottle-types/${bt.body.id}`, { notes: 'Glass, screw cap' });
    const list = (await t.call('GET', '/api/bottle-types')).body;
    expect(list).toHaveLength(1);
    expect(list[0].notes).toBe('Glass, screw cap');
  });

  it('ships the English catalog with the Slovak names as aliases', async () => {
    const catalog = (await t.call('GET', '/api/catalog')).body as { name: string; kind: string; aliases: string[] }[];
    expect(catalog.find((c) => c.kind === 'acid' && c.aliases.includes('ocot'))).toMatchObject({
      name: 'Spirit vinegar 8 %',
      aliases: ['Ocot kvasný liehový 8 %', 'ocot'],
    });
    expect(catalog.find((c) => c.name === 'Salt')).toMatchObject({ kind: 'salt', aliases: ['Soľ'] });
  });

  it('refuses propagation for bought lots', async () => {
    const variety = (await t.call('POST', '/api/varieties', { id: id(), name: 'Cayenne' })).body;
    const res = await t.call('POST', '/api/lots', { id: id(), variety_id: variety.id, season: 2024, origin: 'bought', propagation: 'seed' });
    expect(res.status).toBe(400);
  });

  it('reads and updates the target salt percentage', async () => {
    expect((await t.call('GET', '/api/settings')).body).toEqual({ target_salt_pct: 3 });
    expect((await t.call('PATCH', '/api/settings', { target_salt_pct: 2.5 })).body).toEqual({ target_salt_pct: 2.5 });
  });
  it('resolves SHU from the variety through the lot', async () => {
    const variety = (await t.call('POST', '/api/varieties', { id: id(), name: 'Habanero', shu_min: 100000, shu_max: 350000 })).body;
    const lot = (await t.call('POST', '/api/lots', { id: id(), variety_id: variety.id, season: 2026, origin: 'grown', propagation: 'seed' })).body;
    const batch = await newBatch();
    const step = await addStep(batch.id, { type: 'ferment' });
    await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name: 'Habanero', kind: 'pepper', grams: 100, lot_id: lot.id });
    await t.call('POST', `/api/steps/${step.id}/lines`, { id: id(), name: 'Mrkva', kind: 'vegetable', grams: 100 });
    const view = (await t.call('GET', `/api/batches/${batch.id}`)).body;
    expect(view.steps[0].lines[0].shu).toEqual({ min: 100000, max: 350000, source: null });
    expect(view.derived.heat).toEqual({ low: 50000, high: 175000, unknown: [] });
  });
});
