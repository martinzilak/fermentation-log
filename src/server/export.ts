// Export (SPEC §10.2): one batch file per batch in the §10.1 format, all.json
// with every table, and the media they refer to. The nightly job writes these
// to DATA_DIR/exports/; the download zips the same files. Deleted batches are
// left out (SPEC §15.2); the database backups keep them.
import fs from 'node:fs';
import path from 'node:path';
import { Document, isCollection } from 'yaml';
import { localDate } from '../shared/calc.ts';
import type { BottledPayload, EventType, FermentParams } from '../shared/schemas.ts';
import { loadBatch } from './batch-view.ts';
import type { DB } from './db.ts';
import type { Row } from './store.ts';

export interface ExportContext {
  db: DB;
  mediaDir: string;
  timeZone: string;
  now: Date;
}

/** A file of the export: generated text, or a media file copied as is. */
export type ExportFile = { name: string; text: string } | { name: string; source: string };

type BatchView = NonNullable<ReturnType<typeof loadBatch>>;
type LineView = BatchView['steps'][number]['lines'][number];
interface EventView {
  type: EventType;
  occurred_at: string;
  text: string | null;
  payload: unknown;
  attachments: Row[];
  net_g?: number | null;
}
const eventsOf = (b: BatchView) => b.events as unknown as EventView[];

export const batchFileName = (number: number) => `batch-${String(number).padStart(3, '0')}.md`;

const names = (db: DB, table: string) =>
  new Map((db.prepare(`SELECT id, name FROM ${table}`).all() as { id: string; name: string }[]).map((r) => [r.id, r.name]));

/** The reference data a batch file names instead of pointing at. */
function lookups(db: DB) {
  return {
    vessels: names(db, 'vessels'),
    recipes: names(db, 'recipes'),
    bottles: new Map(
      (db.prepare('SELECT id, name, volume_ml FROM bottle_types').all() as { id: string; name: string; volume_ml: number }[]).map(
        (b) => [b.id, b],
      ),
    ),
    lots: new Map((db.prepare('SELECT * FROM pepper_lots').all() as Row[]).map((l) => [l.id as string, l])),
  };
}
type Lookups = ReturnType<typeof lookups>;

const shuValue = (min: number | null, max: number | null) => (min !== null && min === max ? min : [min, max]);

function addEntry(l: LineView, lots: Lookups['lots']): Row {
  const lot = l.lot_id ? lots.get(l.lot_id) : undefined;
  return {
    name: l.name,
    ...(l.local_name ? { local: l.local_name } : {}),
    kind: l.kind,
    ...(lot
      ? {
          lot: {
            origin: lot.origin,
            ...(lot.propagation ? { propagation: lot.propagation } : {}),
            season: lot.season,
            ...(lot.supplier ? { supplier: lot.supplier } : {}),
            ...(lot.acquired_on ? { acquired: lot.acquired_on } : {}),
          },
        }
      : {}),
    g: l.grams,
    ...(l.planned_g !== null ? { planned_g: l.planned_g } : {}),
    ...(l.shu ? { shu: shuValue(l.shu.min, l.shu.max), ...(l.shu.source ? { shu_source: l.shu.source } : {}) } : {}),
    ...(l.note ? { note: l.note } : {}),
  };
}

function stepParams(step: BatchView['steps'][number], vessels: Lookups['vessels']): Row | undefined {
  const params = (step.params ?? {}) as Row;
  if (step.type === 'ferment') {
    const { vessel_id, vessel_tare_g } = params as FermentParams;
    const vessel = vessel_id ? vessels.get(vessel_id) : undefined;
    return { ...(vessel ? { vessel } : {}), vessel_tare_g: vessel_tare_g ?? null };
  }
  const set = Object.entries(params).filter(([, value]) => value !== null && value !== undefined);
  return set.length ? Object.fromEntries(set) : undefined;
}

function fills(payload: BottledPayload, bottles: Lookups['bottles']): Row[] {
  return payload.fills.map((f) => {
    if ('volume_ml' in f) return { ...(f.label ? { label: f.label } : {}), ml: f.volume_ml, count: f.count };
    const bottle = bottles.get(f.bottle_type_id);
    return { bottle: bottle?.name ?? 'Unknown bottle', ml: bottle?.volume_ml ?? null, count: f.count };
  });
}

function frontmatter(b: BatchView, refs: Lookups, timeZone: string): Row {
  const bottled = eventsOf(b).find((e) => e.type === 'bottled');
  const out = bottled?.payload as BottledPayload | undefined;
  return {
    batch: b.number,
    ...(b.name ? { name: b.name } : {}),
    color: b.color,
    status: b.status,
    recipe: (b.recipe_id && refs.recipes.get(b.recipe_id)) || null,
    steps: b.steps.map((s) => {
      const params = stepParams(s, refs.vessels);
      return {
        type: s.type,
        date: s.date,
        ...(params ? { params } : {}),
        ...(s.note ? { note: s.note } : {}),
        add: s.lines.map((l) => addEntry(l, refs.lots)),
      };
    }),
    ...(bottled && out
      ? {
          bottled: localDate(bottled.occurred_at, timeZone),
          output: {
            ph: out.ph ?? null,
            ...(out.ph_not_measured_reason ? { ph_not_measured_reason: out.ph_not_measured_reason } : {}),
            fills: fills(out, refs.bottles),
            ...(out.leftover_g != null ? { leftover_g: out.leftover_g } : {}),
            ...(out.total_g != null ? { total_g: out.total_g } : {}),
          },
        }
      : {}),
  };
}

/** YAML in the seed files' layout: steps as blocks, each addition on one line. */
function yaml(data: Row): string {
  const doc = new Document(data);
  const steps = doc.get('steps', true);
  if (isCollection(steps)) {
    for (const step of steps.items) {
      if (!isCollection(step)) continue;
      const params = step.get('params', true);
      if (isCollection(params)) params.flow = true;
      const add = step.get('add', true);
      if (isCollection(add)) for (const entry of add.items) if (isCollection(entry)) entry.flow = true;
    }
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

function stamp(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${localDate(iso, timeZone)} ${parts.hour}:${parts.minute}`;
}

function describeEvent(e: EventView, bottles: Lookups['bottles']): string {
  const p = e.payload as Row;
  switch (e.type) {
    case 'ph':
      return `pH ${p.value} (${p.method})`;
    case 'weigh':
      return `Weighed ${p.gross_g} g gross${typeof e.net_g === 'number' ? `, ${e.net_g} g net` : ''}`;
    case 'burp':
      return 'Burped';
    case 'issue':
      return `Issue: ${p.kind}`;
    case 'tasting':
      return `Tasting: ${'★'.repeat(p.rating as number)}${'☆'.repeat(5 - (p.rating as number))}`;
    case 'bottled': {
      const out = p as unknown as BottledPayload;
      const bottled = fills(out, bottles).map((f) => `${f.count} × ${f.ml} ml${f.bottle || f.label ? ` ${f.bottle ?? f.label}` : ''}`);
      return [
        `Bottled${bottled.length ? `: ${bottled.join(', ')}` : ''}`,
        ...(out.ph != null ? [`pH ${out.ph}`] : out.ph_not_measured_reason ? [`pH not measured: ${out.ph_not_measured_reason}`] : []),
        ...(out.leftover_g != null ? [`${out.leftover_g} g left over`] : []),
      ].join('; ');
    }
    case 'voice':
      return 'Voice note';
    case 'photo':
      return 'Photo';
    default:
      return 'Note';
  }
}

/** The generated `## Timeline`: every event, oldest first, with its media. */
function timeline(b: BatchView, bottles: Lookups['bottles'], timeZone: string): string {
  const indent = (text: string) => text.replace(/\n/g, '\n  ');
  return [...eventsOf(b)]
    .reverse()
    .map((e) => {
      const text = e.text?.trim() ? `: ${indent(e.text.trim())}` : '';
      const media = e.attachments.map((a) =>
        a.type === 'photo' ? `\n  ![photo](media/${a.file})` : `\n  [audio](media/${a.file})`,
      );
      return `- ${stamp(e.occurred_at, timeZone)} · ${describeEvent(e, bottles)}${text}${media.join('')}`;
    })
    .join('\n');
}

/** The batch notes with the timeline before `## Tasting`, where §10.1 puts it. */
function body(notes: string, events: string): string {
  if (!events) return notes;
  const section = `## Timeline\n${events}`;
  const at = notes.search(/^## Tasting/m);
  if (at === -1) return [notes, section].filter(Boolean).join('\n\n');
  return `${notes.slice(0, at)}${section}\n\n${notes.slice(at)}`;
}

function batchText(b: BatchView, refs: Lookups, timeZone: string): string {
  return `---\n${yaml(frontmatter(b, refs, timeZone))}---\n\n${body(b.notes_md.trim(), timeline(b, refs.bottles, timeZone))}\n`;
}

/** One batch's file, or undefined for a missing or deleted batch. */
export function exportBatch(ctx: ExportContext, id: string): { name: string; text: string } | undefined {
  const b = loadBatch(ctx.db, id, ctx);
  if (!b || b.deleted_at) return undefined;
  return { name: batchFileName(b.number), text: batchText(b, lookups(ctx.db), ctx.timeZone) };
}

const DELETED = 'SELECT id FROM batches WHERE deleted_at IS NOT NULL';
const LIVE_ROWS: Record<string, string> = {
  batches: 'WHERE deleted_at IS NULL',
  steps: `WHERE batch_id NOT IN (${DELETED})`,
  ingredient_lines: `WHERE batch_id NOT IN (${DELETED})`,
  events: `WHERE batch_id NOT IN (${DELETED})`,
  attachments: `WHERE event_id NOT IN (SELECT id FROM events WHERE batch_id IN (${DELETED}))`,
};

/** Every table's rows as stored, JSON columns still as text. */
export function dumpTables(db: DB): Record<string, Row[]> {
  const tables = db
    // Push subscriptions are a device's address, not part of the record.
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'push_subscriptions' ORDER BY name")
    .pluck()
    .all() as string[];
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ${LIVE_ROWS[t] ?? ''} ORDER BY rowid`).all() as Row[]]));
}

/** Every file of a full export, batch files first. Media missing on disk is skipped. */
export function exportFiles(ctx: ExportContext): ExportFile[] {
  const tables = dumpTables(ctx.db);
  const refs = lookups(ctx.db);
  const batches = (tables.batches ?? [])
    .map((r) => loadBatch(ctx.db, r.id as string, ctx)!)
    .sort((a, b) => a.number - b.number)
    .map((b) => ({ name: batchFileName(b.number), text: batchText(b, refs, ctx.timeZone) }));
  const media = (tables.attachments ?? [])
    .flatMap((a) => [a.file, a.thumb])
    .filter((f): f is string => typeof f === 'string')
    .flatMap((file) => {
      const source = path.join(ctx.mediaDir, file);
      if (fs.existsSync(source)) return [{ name: `media/${file}`, source }];
      console.warn(`Export: media file missing, skipped: ${file}`);
      return [];
    });
  const all = { exported_at: ctx.now.toISOString(), tables };
  return [...batches, { name: 'all.json', text: `${JSON.stringify(all, null, 2)}\n` }, ...media];
}

/**
 * Writes a full export to `dir`, replacing the previous one only once the new
 * one is complete. Media are hard-linked where the filesystem allows.
 */
export function writeExport(ctx: ExportContext, dir: string): number {
  const next = `${dir}.next`;
  const old = `${dir}.old`;
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(path.join(next, 'media'), { recursive: true });
  const files = exportFiles(ctx);
  for (const f of files) {
    const target = path.join(next, f.name);
    if ('text' in f) fs.writeFileSync(target, f.text);
    else {
      try {
        fs.linkSync(f.source, target);
      } catch {
        fs.copyFileSync(f.source, target);
      }
    }
  }
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(dir)) fs.renameSync(dir, old);
  fs.renameSync(next, dir);
  fs.rmSync(old, { recursive: true, force: true });
  return files.length;
}
