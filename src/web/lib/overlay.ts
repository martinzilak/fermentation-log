// Shows writes that the server hasn't confirmed yet (SPEC §8.5): the queued
// ones, and ones sent since the cached data was fetched. They are applied to
// the cached batch views and the batch list, so weighing keeps its live salt %
// and the timeline shows a pH reading while the server is out of reach.
// Applying a write the data already holds changes nothing.
import { derive, type CalcEvent, type CalcStep } from '../../shared/calc.ts';
import { autoStatus } from '../../shared/status.ts';
import type { Op } from './outbox.ts';
import type { BatchSummary, BatchView, EventView, LineView, Lot, StepView } from './types.ts';

export interface OverlayContext {
  timeZone: string;
  today: string;
  targetSaltPct: number;
  volumeMl: (bottleTypeId: string) => number | undefined;
}

type Body = Record<string, unknown>;

const BATCH_VIEW = /^\/api\/batches\/([0-9a-f-]{36})$/;

/** The parts of a write's URL: `/api/<collection>/<id>/<sub>`. */
function target(op: Op) {
  const [, , collection, id, sub] = op.url.split('/');
  return { collection, id, sub, body: (op.json ?? {}) as Body };
}

const pick = <T extends object>(body: Body, keys: (keyof T)[]): Partial<T> =>
  Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k as string]])) as Partial<T>;

const STEP_KEYS: (keyof StepView)[] = ['type', 'position', 'date', 'params', 'note'];
const LINE_KEYS: (keyof LineView)[] = [
  'position', 'name', 'local_name', 'kind', 'grams', 'planned_g', 'lot_id', 'catalog_id', 'variety_id', 'note', 'shu_min', 'shu_max', 'shu_source',
];
const EVENT_KEYS: (keyof EventView)[] = ['step_id', 'occurred_at', 'text', 'payload'];
const BATCH_KEYS: (keyof BatchView)[] = ['number', 'name', 'color', 'status', 'status_manual', 'notes_md'];

const nextPosition = (items: { position: number }[]) => items.reduce((max, i) => Math.max(max, i.position + 1), 0);

function lineShu(l: LineView): LineView['shu'] {
  if (l.shu_min !== null || l.shu_max !== null) return { min: l.shu_min, max: l.shu_max, source: l.shu_source };
  return l.shu;
}

function newLine(stepId: string, body: Body, position: number): LineView {
  const line: LineView = {
    id: body.id as string,
    step_id: stepId,
    position,
    name: body.name as string,
    local_name: null,
    kind: body.kind as LineView['kind'],
    grams: null,
    planned_g: null,
    lot_id: null,
    catalog_id: null,
    note: null,
    variety_id: null,
    variety_name: null,
    shu_min: null,
    shu_max: null,
    shu_source: null,
    shu: null,
    ...pick<LineView>(body, LINE_KEYS),
  };
  return { ...line, shu: lineShu(line) };
}

const mapSteps = (view: BatchView, f: (s: StepView) => StepView | null): StepView[] =>
  view.steps.flatMap((s) => {
    const out = f(s);
    return out ? [out] : [];
  });

/** One write applied to one batch view; null when it deletes the batch. */
function applyToView(view: BatchView, op: Op): BatchView | null {
  const { collection, id, sub, body } = target(op);
  if (collection === 'batches' && id === view.id) {
    if (op.method === 'DELETE' && !sub) return null;
    if (op.method === 'PATCH' && !sub) return { ...view, ...pick<BatchView>(body, BATCH_KEYS) };
    if (op.method === 'POST' && sub === 'steps' && !view.steps.some((s) => s.id === body.id)) {
      const step: StepView = {
        id: body.id as string,
        type: body.type as StepView['type'],
        position: nextPosition(view.steps),
        date: null,
        params: {},
        note: null,
        lines: [],
        ...pick<StepView>(body, STEP_KEYS),
      };
      return { ...view, steps: [...view.steps, step].sort((a, b) => a.position - b.position) };
    }
    if (op.method === 'POST' && sub === 'events' && !view.events.some((e) => e.id === body.id)) {
      const event: EventView = {
        id: body.id as string,
        type: body.type as EventView['type'],
        step_id: null,
        occurred_at: new Date().toISOString(),
        text: null,
        payload: {},
        author: '',
        attachments: [],
        ...pick<EventView>(body, EVENT_KEYS),
      };
      const events = [event, ...view.events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
      return { ...view, events };
    }
    return view;
  }
  if (collection === 'steps' && view.steps.some((s) => s.id === id)) {
    if (op.method === 'PATCH') return { ...view, steps: mapSteps(view, (s) => (s.id === id ? { ...s, ...pick<StepView>(body, STEP_KEYS) } : s)) };
    if (op.method === 'DELETE') return { ...view, steps: mapSteps(view, (s) => (s.id === id ? null : s)) };
    if (op.method === 'POST' && sub === 'lines') {
      return {
        ...view,
        steps: mapSteps(view, (s) =>
          s.id === id && !s.lines.some((l) => l.id === body.id)
            ? { ...s, lines: [...s.lines, newLine(s.id, body, nextPosition(s.lines))] }
            : s,
        ),
      };
    }
  }
  if (collection === 'lines' && view.steps.some((s) => s.lines.some((l) => l.id === id))) {
    if (op.method === 'PATCH') {
      return {
        ...view,
        steps: mapSteps(view, (s) => ({
          ...s,
          lines: s.lines.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...pick<LineView>(body, LINE_KEYS) };
            return { ...next, shu: lineShu(next) };
          }),
        })),
      };
    }
    if (op.method === 'DELETE') return { ...view, steps: mapSteps(view, (s) => ({ ...s, lines: s.lines.filter((l) => l.id !== id) })) };
  }
  if (collection === 'events' && view.events.some((e) => e.id === id)) {
    if (op.method === 'PATCH') return { ...view, events: view.events.map((e) => (e.id === id ? { ...e, ...pick<EventView>(body, EVENT_KEYS) } : e)) };
    if (op.method === 'DELETE') return { ...view, events: view.events.filter((e) => e.id !== id) };
  }
  return view;
}

/** Status and derived values recomputed as the server would (SPEC §6.3, §7.2). */
function rederive(view: BatchView, ctx: OverlayContext): BatchView {
  const status = view.status_manual ? view.status : autoStatus(view.steps, view.events);
  const steps: CalcStep[] = view.steps.map((s) => ({
    type: s.type,
    position: s.position,
    date: s.date,
    lines: s.lines.map((l) => ({ name: l.name, kind: l.kind, grams: l.grams, shu_min: l.shu?.min ?? null, shu_max: l.shu?.max ?? null })),
  }));
  const events: CalcEvent[] = view.events.map((e) => ({ type: e.type, occurred_at: e.occurred_at, payload: e.payload }));
  return { ...view, status, derived: derive(steps, events, status, ctx) };
}

/** A batch started while the server is out of reach, before it has any server data. */
function newBatchView(op: Op, ctx: OverlayContext): BatchView {
  const body = (op.json ?? {}) as Body;
  return rederive(
    {
      id: body.id as string,
      number: (body.number as number | undefined) ?? 0,
      name: (body.name as string | null | undefined) ?? null,
      color: (body.color as string | null | undefined) ?? null,
      status: 'planned',
      status_manual: false,
      recipe_id: null,
      notes_md: (body.notes_md as string | undefined) ?? '',
      steps: [],
      events: [],
      derived: undefined as unknown as BatchView['derived'],
    },
    ctx,
  );
}

const createsBatch = (op: Op, id?: string) =>
  op.method === 'POST' && op.url === '/api/batches' && (id === undefined || (op.json as Body | undefined)?.id === id);

export function overlayBatch(id: string, data: BatchView | undefined, ops: readonly Op[], ctx: OverlayContext): BatchView | undefined {
  let view = data;
  if (!view) {
    const create = ops.find((op) => createsBatch(op, id));
    if (!create) return undefined;
    view = newBatchView(create, ctx);
  }
  let changed = false;
  for (const op of ops) {
    const next = applyToView(view, op);
    if (next === null) return undefined;
    if (next !== view) changed = true;
    view = next;
  }
  return changed ? rederive(view, ctx) : view;
}

export function overlayList(data: BatchSummary[] | undefined, ops: readonly Op[]): BatchSummary[] | undefined {
  let list = data;
  for (const op of ops) {
    const { collection, id, sub, body } = target(op);
    if (collection !== 'batches') continue;
    if (createsBatch(op)) {
      if (!list || list.some((b) => b.id === body.id)) continue;
      const created: BatchSummary = {
        id: body.id as string,
        number: (body.number as number | undefined) ?? 0,
        name: (body.name as string | null | undefined) ?? null,
        color: (body.color as string | null | undefined) ?? null,
        status: 'planned',
        ferment_date: null,
        ferment_day: null,
        due: [],
      };
      list = [...list, created].sort((a, b) => b.number - a.number);
    } else if (list && !sub && op.method === 'DELETE') list = list.filter((b) => b.id !== id);
    else if (list && !sub && op.method === 'PATCH') list = list.map((b) => (b.id === id ? { ...b, ...pick<BatchSummary>(body, ['number', 'name', 'color', 'status']) } : b));
  }
  return list;
}

/** Lots added while weighing, before the server has them. */
function overlayLots(data: Lot[] | undefined, ops: readonly Op[]): Lot[] | undefined {
  let lots = data;
  for (const op of ops) {
    const body = op.json as (Partial<Lot> & Pick<Lot, 'id' | 'variety_id' | 'season' | 'origin'>) | undefined;
    if (!lots || op.method !== 'POST' || op.url !== '/api/lots' || !body || lots.some((l) => l.id === body.id)) continue;
    lots = [...lots, { propagation: null, supplier: null, acquired_on: null, uses: 0, ...body }];
  }
  return lots;
}

/** The cached response for `url` with the unconfirmed writes applied. */
export function overlay(url: string, data: unknown, ops: readonly Op[], ctx: OverlayContext): unknown {
  if (ops.length === 0) return data;
  if (url === '/api/batches') return overlayList(data as BatchSummary[] | undefined, ops);
  if (url === '/api/lots') return overlayLots(data as Lot[] | undefined, ops);
  const m = BATCH_VIEW.exec(url);
  return m ? overlayBatch(m[1]!, data as BatchView | undefined, ops, ctx) : data;
}
