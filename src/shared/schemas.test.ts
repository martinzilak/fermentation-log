import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { BatchPatch, Line, Lot, parseEventPayload, parseStepParams } from './schemas.ts';

const id = '6f1d6c1e-7f5a-4c1e-9a77-0d3c2b1a0f9e';

describe('resource schemas', () => {
  it('requires a client-generated UUID on create', () => {
    expect(v.safeParse(Line.create, { name: 'Cesnak', kind: 'aromatic' }).success).toBe(false);
    expect(v.safeParse(Line.create, { id: 'nope', name: 'Cesnak', kind: 'aromatic' }).success).toBe(false);
    expect(v.parse(Line.create, { id, name: ' Cesnak ', kind: 'aromatic', grams: 35 })).toEqual({
      id,
      name: 'Cesnak',
      kind: 'aromatic',
      grams: 35,
    });
  });

  it('lets PATCH clear nullable fields and rejects negative grams', () => {
    expect(v.parse(Line.patch, { grams: null })).toEqual({ grams: null });
    expect(v.safeParse(Line.patch, { grams: -1 }).success).toBe(false);
    expect(v.safeParse(Line.patch, { kind: 'spice' }).success).toBe(false);
  });

  it('accepts a status override or null on batch PATCH', () => {
    expect(v.parse(BatchPatch, { status: 'archived' })).toEqual({ status: 'archived' });
    expect(v.parse(BatchPatch, { status: null })).toEqual({ status: null });
    expect(v.safeParse(BatchPatch, { status: 'done' }).success).toBe(false);
  });

  it('validates lot origin values', () => {
    const lot = { id, variety_id: id, season: 2025, origin: 'grown', propagation: 'sapling' };
    expect(v.safeParse(Lot.create, lot).success).toBe(true);
    expect(v.safeParse(Lot.create, { ...lot, origin: 'stolen' }).success).toBe(false);
  });
});

describe('typed params and payloads', () => {
  it('checks step params by step type and strips unknown keys', () => {
    expect(parseStepParams('ferment', { vessel_tare_g: 1669, extra: 1 }).output).toEqual({ vessel_tare_g: 1669 });
    expect(parseStepParams('cook', { minutes: -5 }).success).toBe(false);
    expect(parseStepParams('blend', undefined).output).toEqual({});
  });

  it('checks event payloads by event type', () => {
    expect(parseEventPayload('ph', { value: 3.6, method: 'meter' }).success).toBe(true);
    expect(parseEventPayload('ph', { value: 15, method: 'meter' }).success).toBe(false);
    expect(parseEventPayload('tasting', { rating: 6 }).success).toBe(false);
    expect(parseEventPayload('bottled', { fills: [] }).success).toBe(true);
    expect(parseEventPayload('bottled', { fills: [{ bottle_type_id: id, count: 0 }] }).success).toBe(false);
  });
});
