import { describe, expect, it } from 'vitest';
import type { Op } from './outbox.ts';
import { overlay, type OverlayContext } from './overlay.ts';
import type { BatchSummary, BatchView } from './types.ts';

const ctx: OverlayContext = { timeZone: 'Europe/Bratislava', today: '2026-10-29', targetSaltPct: 3, volumeMl: () => 250 };
const B = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const url = `/api/batches/${B}`;

let seq = 0;
const op = (method: Op['method'], path: string, json?: unknown): Op => ({ seq: ++seq, method, url: path, ...(json ? { json } : {}) });

function batch(): BatchView {
  return {
    id: B,
    number: 5,
    name: null,
    color: null,
    status: 'fermenting',
    status_manual: false,
    recipe_id: null,
    notes_md: '',
    steps: [{ id: S, type: 'ferment', position: 0, date: '2026-10-20', params: { vessel_tare_g: 1650 }, note: null, lines: [] }],
    events: [
      { id: 'e0', step_id: null, type: 'note', occurred_at: '2026-10-21T08:00:00.000Z', text: 'Started', payload: {}, author: 'cook', attachments: [] },
    ],
    derived: {} as BatchView['derived'],
  };
}

const line = (id: string, name: string, kind: string, grams: number) => op('POST', `/api/steps/${S}/lines`, { id, name, kind, grams });

describe('overlay of unconfirmed writes (SPEC §8.5)', () => {
  it('adds queued lines to their step and recomputes salt % for weighing', () => {
    const view = overlay(url, batch(), [line('l1', 'Jalapeño', 'pepper', 1000), line('l2', 'Salt', 'salt', 30)], ctx) as BatchView;
    expect(view.steps[0]!.lines.map((l) => [l.name, l.grams, l.position])).toEqual([
      ['Jalapeño', 1000, 0],
      ['Salt', 30, 1],
    ]);
    expect(view.derived.salt_pct).toBe(3);
  });

  it('changes nothing for a write the fetched data already holds', () => {
    const fetched = overlay(url, batch(), [line('l1', 'Jalapeño', 'pepper', 970)], ctx) as BatchView;
    const again = overlay(url, fetched, [line('l1', 'Jalapeño', 'pepper', 970)], ctx) as BatchView;
    expect(again.steps[0]!.lines).toHaveLength(1);
  });

  it('applies edits and deletes in order, including an Undo', () => {
    const ops = [
      line('l1', 'Garlic', 'aromatic', 30),
      op('PATCH', '/api/lines/l1', { grams: 35 }),
      line('l2', 'Carrot', 'vegetable', 200),
      op('DELETE', '/api/lines/l2'),
      op('PATCH', `/api/steps/${S}`, { params: { vessel_tare_g: 1700 } }),
    ];
    const view = overlay(url, batch(), ops, ctx) as BatchView;
    expect(view.steps[0]!.lines.map((l) => [l.name, l.grams])).toEqual([['Garlic', 35]]);
    expect(view.steps[0]!.params.vessel_tare_g).toBe(1700);
  });

  it('puts a queued event in the timeline by its time, and bottling sets the status', () => {
    const ops = [
      op('POST', `${url}/events`, { id: 'e1', type: 'ph', occurred_at: '2026-10-22T08:00:00.000Z', payload: { value: 3.6, method: 'meter' } }),
      op('POST', `${url}/events`, { id: 'e2', type: 'bottled', occurred_at: '2026-10-29T08:00:00.000Z', payload: { fills: [{ bottle_type_id: 'x', count: 4 }] } }),
    ];
    const view = overlay(url, batch(), ops, ctx) as BatchView;
    expect(view.events.map((e) => e.id)).toEqual(['e2', 'e1', 'e0']);
    expect(view.status).toBe('bottled');
    expect(view.derived.bottled_volume_ml).toBe(1000);
  });

  it('builds a batch started while the server was out of reach', () => {
    const N = '33333333-3333-4333-8333-333333333333';
    const ops = [
      op('POST', '/api/batches', { id: N, number: 6 }),
      op('POST', `/api/batches/${N}/steps`, { id: S, type: 'ferment', date: '2026-10-29', params: {} }),
      line('l1', 'Habanero', 'pepper', 500),
    ];
    const view = overlay(`/api/batches/${N}`, undefined, ops, ctx) as BatchView;
    expect(view).toMatchObject({ id: N, number: 6, status: 'fermenting' });
    expect(view.steps[0]!.lines.map((l) => l.name)).toEqual(['Habanero']);
    expect(overlay(`/api/batches/${B}`, undefined, ops, ctx)).toBeUndefined();

    const list = overlay('/api/batches', [{ id: B, number: 5 } as BatchSummary], ops, ctx) as BatchSummary[];
    expect(list.map((b) => b.number)).toEqual([6, 5]);
  });

  it('hides a batch deleted while queued, and leaves other URLs alone', () => {
    expect(overlay(url, batch(), [op('DELETE', url)], ctx)).toBeUndefined();
    expect(overlay('/api/batches', [{ id: B, number: 5 } as BatchSummary], [op('DELETE', url)], ctx)).toEqual([]);
    const catalog = [{ id: 'c' }];
    expect(overlay('/api/catalog', catalog, [line('l1', 'Salt', 'salt', 1)], ctx)).toBe(catalog);
  });

  it('returns the data as is when no write touches the batch', () => {
    const data = batch();
    expect(overlay(url, data, [op('POST', '/api/steps/other/lines', { id: 'x', name: 'Salt', kind: 'salt' })], ctx)).toBe(data);
  });
});
