// Derived values (SPEC §7.1, §7.2). Computed on read, never stored.
import type { BottledPayload, EventType, Kind, StepType } from './schemas.ts';

export interface CalcLine {
  name: string;
  kind: Kind;
  grams: number | null;
  /** Resolved SHU bounds: the line override, else the variety's. */
  shu_min: number | null;
  shu_max: number | null;
}

export interface CalcStep {
  type: StepType;
  position: number;
  date: string | null;
  lines: CalcLine[];
}

export interface CalcEvent {
  type: EventType;
  occurred_at: string;
  payload: unknown;
}

export type Base = 'peppers' | 'solids' | 'ferment_total' | 'mash' | 'sauce';

export interface HeatEstimate {
  low: number;
  high: number;
  /** Pepper lines without any SHU value; they count as 0. */
  unknown: string[];
}

export interface Derived {
  salt_pct: number | null;
  suggested_salt_g: number | null;
  ferment_days: number | null;
  /** Days since the ferment step's date, for batches still fermenting ("Day 7"). */
  ferment_day: number | null;
  sauce_additions_g: number;
  measured_total_g: number | null;
  xanthan_pct: number | null;
  heat: HeatEstimate | null;
  bottled_volume_ml: number | null;
}

const grams = (lines: CalcLine[]) => lines.reduce((sum, l) => sum + (l.grams ?? 0), 0);

function sorted(steps: CalcStep[]): CalcStep[] {
  return [...steps].sort((a, b) => a.position - b.position);
}

function fermentStep(steps: CalcStep[]): CalcStep | undefined {
  return sorted(steps).find((s) => s.type === 'ferment');
}

/** Lines added after the ferment step (all lines when there is no ferment step). */
function sauceLines(steps: CalcStep[]): CalcLine[] {
  const ferment = fermentStep(steps);
  return sorted(steps)
    .filter((s) => (ferment ? s.position > ferment.position : true))
    .flatMap((s) => s.lines);
}

export function bases(steps: CalcStep[]): Record<Base, number> {
  const ferment = fermentStep(steps)?.lines ?? [];
  return {
    peppers: grams(ferment.filter((l) => l.kind === 'pepper')),
    solids: grams(ferment.filter((l) => l.kind !== 'water' && l.kind !== 'salt')),
    ferment_total: grams(ferment.filter((l) => l.kind !== 'salt')),
    mash: grams(steps.flatMap((s) => s.lines).filter((l) => l.kind === 'mash')),
    sauce: grams(sauceLines(steps)),
  };
}

export function saltPct(steps: CalcStep[]): number | null {
  const ferment = fermentStep(steps);
  if (!ferment) return null;
  const total = bases(steps).ferment_total;
  if (total <= 0) return null;
  return (grams(ferment.lines.filter((l) => l.kind === 'salt')) / total) * 100;
}

export function suggestedSaltG(steps: CalcStep[], targetPct: number): number | null {
  if (!fermentStep(steps)) return null;
  return (targetPct * bases(steps).ferment_total) / 100;
}

/** Whole days from date `a` to date `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The calendar date (YYYY-MM-DD) of a UTC timestamp in a time zone. */
export function localDate(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(timestamp),
  );
}

function firstBottled(events: CalcEvent[]): CalcEvent | undefined {
  return events.filter((e) => e.type === 'bottled').sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];
}

/**
 * Ferment step date → date of the first later step that has one, falling
 * back to the bottled event's date.
 */
export function fermentDays(steps: CalcStep[], events: CalcEvent[], timeZone: string): number | null {
  const ferment = fermentStep(steps);
  if (!ferment?.date) return null;
  const next = sorted(steps).find((s) => s.position > ferment.position && s.date);
  const bottled = firstBottled(events);
  const end = next?.date ?? (bottled ? localDate(bottled.occurred_at, timeZone) : null);
  return end ? daysBetween(ferment.date, end) : null;
}

export function xanthanPct(steps: CalcStep[]): number | null {
  const sauce = sauceLines(steps);
  if (!sauce.some((l) => l.kind === 'mash')) return null;
  const total = grams(sauce);
  if (total <= 0) return null;
  return (grams(sauce.filter((l) => l.kind === 'thickener')) / total) * 100;
}

/** Rough heat: Σ(pepper grams × SHU) / solids, low end from minimums, high end from maximums. */
export function heatEstimate(steps: CalcStep[]): HeatEstimate | null {
  const solids = bases(steps).solids;
  const peppers = (fermentStep(steps)?.lines ?? []).filter((l) => l.kind === 'pepper' && l.grams);
  if (solids <= 0 || peppers.length === 0) return null;
  let low = 0;
  let high = 0;
  const unknown: string[] = [];
  for (const p of peppers) {
    const min = p.shu_min ?? p.shu_max;
    const max = p.shu_max ?? p.shu_min;
    if (min === null || max === null) {
      unknown.push(p.name);
      continue;
    }
    low += p.grams! * min;
    high += p.grams! * max;
  }
  return { low: low / solids, high: high / solids, unknown };
}

export function netWeight(grossG: number, tareG: number | null | undefined): number | null {
  return tareG === null || tareG === undefined ? null : grossG - tareG;
}

export function bottledVolumeMl(payload: BottledPayload, volumeMl: (bottleTypeId: string) => number | undefined) {
  return payload.fills.reduce(
    (sum, f) => sum + f.count * ('volume_ml' in f ? f.volume_ml : (volumeMl(f.bottle_type_id) ?? 0)),
    0,
  );
}

export interface DeriveOptions {
  timeZone: string;
  today: string;
  targetSaltPct: number;
  volumeMl: (bottleTypeId: string) => number | undefined;
}

export function derive(steps: CalcStep[], events: CalcEvent[], status: string, opts: DeriveOptions): Derived {
  const ferment = fermentStep(steps);
  const bottled = firstBottled(events);
  const bottledPayload = bottled?.payload as BottledPayload | undefined;
  return {
    salt_pct: saltPct(steps),
    suggested_salt_g: suggestedSaltG(steps, opts.targetSaltPct),
    ferment_days: fermentDays(steps, events, opts.timeZone),
    ferment_day: status === 'fermenting' && ferment?.date ? daysBetween(ferment.date, opts.today) : null,
    sauce_additions_g: bases(steps).sauce,
    measured_total_g: bottledPayload?.total_g ?? null,
    xanthan_pct: xanthanPct(steps),
    heat: heatEstimate(steps),
    bottled_volume_ml: bottledPayload ? bottledVolumeMl(bottledPayload, opts.volumeMl) : null,
  };
}
