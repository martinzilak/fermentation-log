// Reads a batch with its steps, lines, events and derived values (SPEC §11
// GET /api/batches/:id), and keeps the automatic status up to date.
import { daysBetween, derive, localDate, netWeight, type CalcStep } from '../shared/calc.ts';
import type { BatchStatus, EventType, FermentParams, Kind, ReminderAction, ReminderRule, StepType } from '../shared/schemas.ts';
import { autoStatus } from '../shared/status.ts';
import type { DB } from './db.ts';
import { loggedToday, reminderRules, rulesDue } from './nudges.ts';
import { decode, type Row } from './store.ts';

export const STEP_COLS = { json: ['params'] } as const;
export const EVENT_COLS = { json: ['payload'] } as const;
export const BATCH_COLS = { bool: ['status_manual'] } as const;

export interface ViewContext {
  timeZone: string;
  now: Date;
}

export function today(ctx: ViewContext): string {
  return localDate(ctx.now.toISOString(), ctx.timeZone);
}

function targetSaltPct(db: DB): number {
  const value = db.prepare("SELECT value FROM settings WHERE key = 'target_salt_pct'").pluck().get();
  return Number(value ?? 3);
}

interface Audit {
  created_at: string;
  updated_at: string;
  author: string;
}

interface BatchRow extends Row, Audit {
  id: string;
  number: number;
  name: string | null;
  color: string | null;
  status: BatchStatus;
  status_manual: boolean;
  recipe_id: string | null;
  notes_md: string;
  deleted_at: string | null;
}

interface StepRow extends Row, Audit {
  id: string;
  batch_id: string;
  type: StepType;
  position: number;
  date: string | null;
  params: unknown;
  note: string | null;
}

interface LineRow extends Row, Audit {
  id: string;
  batch_id: string;
  step_id: string;
  position: number;
  name: string;
  local_name: string | null;
  kind: Kind;
  grams: number | null;
  planned_g: number | null;
  lot_id: string | null;
  catalog_id: string | null;
  note: string | null;
  shu_min: number | null;
  shu_max: number | null;
  shu_source: string | null;
  variety_shu_min: number | null;
  variety_shu_max: number | null;
  variety_shu_source: string | null;
  variety_id: string | null;
  variety_name: string | null;
}

/** SHU for a line: the line's own override, else its variety's (SPEC §6.2). */
function resolveShu(l: LineRow) {
  if (l.shu_min !== null || l.shu_max !== null) return { min: l.shu_min, max: l.shu_max, source: l.shu_source };
  if (l.variety_id && (l.variety_shu_min !== null || l.variety_shu_max !== null)) {
    return { min: l.variety_shu_min, max: l.variety_shu_max, source: l.variety_shu_source };
  }
  return null;
}

export function loadBatch(db: DB, id: string, ctx: ViewContext) {
  const batchRow = db.prepare('SELECT * FROM batches WHERE id = ?').get(id) as Row | undefined;
  if (!batchRow) return undefined;
  const batch = decode(batchRow, BATCH_COLS) as BatchRow;

  const steps = (db.prepare('SELECT * FROM steps WHERE batch_id = ? ORDER BY position, created_at').all(id) as Row[]).map(
    (s) => decode(s, STEP_COLS) as StepRow,
  );
  const lineRows = db
    .prepare(
      `SELECT l.*, v.name AS variety_name,
              v.shu_min AS variety_shu_min, v.shu_max AS variety_shu_max, v.shu_source AS variety_shu_source
         FROM ingredient_lines l
         LEFT JOIN varieties v ON v.id = l.variety_id
        WHERE l.batch_id = ?
        ORDER BY l.position, l.created_at`,
    )
    .all(id) as LineRow[];
  const events = (
    db.prepare('SELECT * FROM events WHERE batch_id = ? ORDER BY occurred_at DESC, created_at DESC').all(id) as Row[]
  ).map((e) => decode(e, EVENT_COLS));
  const attachments = db
    .prepare(
      `SELECT a.* FROM attachments a JOIN events e ON e.id = a.event_id
        WHERE e.batch_id = ? ORDER BY a.created_at`,
    )
    .all(id) as Row[];
  const volumes = new Map(
    (db.prepare('SELECT id, volume_ml FROM bottle_types').all() as { id: string; volume_ml: number }[]).map((b) => [
      b.id,
      b.volume_ml,
    ]),
  );

  const stepViews = steps.map((s) => ({
    ...s,
    lines: lineRows
      .filter((l) => l.step_id === s.id)
      .map(({ variety_shu_min, variety_shu_max, variety_shu_source, ...l }) => ({
        ...l,
        shu: resolveShu({ ...l, variety_shu_min, variety_shu_max, variety_shu_source }),
      })),
  }));

  const calcSteps: CalcStep[] = stepViews.map((s) => ({
    type: s.type,
    position: s.position,
    date: s.date,
    lines: s.lines.map((l) => ({
      name: l.name,
      kind: l.kind,
      grams: l.grams,
      shu_min: l.shu?.min ?? null,
      shu_max: l.shu?.max ?? null,
    })),
  }));
  const calcEvents = events.map((e) => ({
    type: e.type as EventType,
    occurred_at: e.occurred_at as string,
    payload: e.payload,
  }));

  const fermentSteps = steps.filter((s) => s.type === 'ferment');
  const tareFor = (stepId: unknown) => {
    const step = fermentSteps.find((s) => s.id === stepId) ?? fermentSteps[0];
    return (step?.params as FermentParams | undefined)?.vessel_tare_g;
  };

  return {
    ...batch,
    steps: stepViews,
    events: events.map((e) => ({
      ...e,
      ...(e.type === 'weigh'
        ? { net_g: netWeight((e.payload as { gross_g: number }).gross_g, tareFor(e.step_id)) }
        : {}),
      attachments: attachments.filter((a) => a.event_id === e.id),
    })),
    derived: derive(calcSteps, calcEvents, batch.status, {
      timeZone: ctx.timeZone,
      today: today(ctx),
      targetSaltPct: targetSaltPct(db),
      volumeMl: (bottleTypeId) => volumes.get(bottleTypeId),
    }),
  };
}

export function listBatches(db: DB, ctx: ViewContext) {
  const rows = db
    .prepare(
      `SELECT b.*, f.date AS ferment_date, json_extract(f.params, '$.needs_burping') AS needs_burping
         FROM batches b
         LEFT JOIN steps f ON f.id = (SELECT s.id FROM steps s WHERE s.batch_id = b.id AND s.type = 'ferment'
                                       ORDER BY s.position LIMIT 1)
        WHERE b.deleted_at IS NULL
        ORDER BY b.number DESC`,
    )
    .all() as Row[];
  const now = today(ctx);
  const rules = reminderRules(db);
  return rows.map(({ needs_burping, ...r }) => {
    const fermentDay = r.status === 'fermenting' && typeof r.ferment_date === 'string' ? daysBetween(r.ferment_date, now) : null;
    return {
      ...decode(r, BATCH_COLS),
      ferment_day: fermentDay,
      // What the reminder rules still ask of it today, for the list (SPEC §15.13).
      due:
        fermentDay === null
          ? []
          : dueToday(rulesDue(rules, fermentDay + 1, needs_burping === 1, loggedToday(db, r.id as string, ctx.now, ctx.timeZone))),
    };
  });
}

/** One entry per action; own-text rules each keep their text. */
function dueToday(rules: Pick<ReminderRule, 'action' | 'text'>[]): { action: ReminderAction; text: string | null }[] {
  const seen = new Set<string>();
  return rules.flatMap((r) => {
    const text = r.action === 'custom' ? (r.text ?? '') : null;
    const key = `${r.action}:${text ?? ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ action: r.action, text }];
  });
}

/** Recomputes the automatic status (SPEC §6.3) unless it was set by hand. */
export function refreshStatus(db: DB, batchId: string, now: string): void {
  const batch = db.prepare('SELECT status, status_manual FROM batches WHERE id = ?').get(batchId) as
    | { status: BatchStatus; status_manual: number }
    | undefined;
  if (!batch || batch.status_manual) return;
  const steps = db.prepare('SELECT type, position, date FROM steps WHERE batch_id = ?').all(batchId) as {
    type: StepType;
    position: number;
    date: string | null;
  }[];
  const events = db.prepare('SELECT type FROM events WHERE batch_id = ?').all(batchId) as { type: EventType }[];
  const status = autoStatus(steps, events);
  if (status !== batch.status) {
    db.prepare('UPDATE batches SET status = ?, updated_at = ? WHERE id = ?').run(status, now, batchId);
  }
}
