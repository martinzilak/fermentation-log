// Imports batch files (SPEC §10.1, §10.3): Markdown with YAML frontmatter.
// Creates batches, steps, lines, varieties, lots, vessels and bottle types as
// needed. Ingredient names resolve through the aliases, so the Slovak seed
// files land on the English entries (SPEC §15.3). Idempotent by batch number.
import { randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { parse as parseYaml } from 'yaml';
import { BATCH_STATUSES, IsoDate, KINDS, ORIGINS, PROPAGATIONS, STEP_TYPES, parseStepParams } from '../shared/schemas.ts';
import { autoStatus } from '../shared/status.ts';
import { BATCH_COLS, EVENT_COLS, STEP_COLS } from './batch-view.ts';
import type { DB } from './db.ts';
import { findOrCreateEntry } from './entries.ts';
import { formatIssues } from './http.ts';
import { insert, update, type Row } from './store.ts';

const Num = v.pipe(v.number(), v.finite());
const ShuValue = v.union([Num, v.tuple([v.nullable(Num), v.nullable(Num)])]);

const LotEntry = v.object({
  origin: v.picklist(ORIGINS),
  propagation: v.optional(v.picklist(PROPAGATIONS)),
  season: v.optional(v.pipe(v.number(), v.integer())),
  supplier: v.optional(v.string()),
  acquired: v.optional(IsoDate),
});

const AddEntry = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  local: v.optional(v.string()),
  kind: v.picklist(KINDS),
  g: v.nullable(Num),
  planned_g: v.optional(v.nullable(Num)),
  lot: v.optional(LotEntry),
  shu: v.optional(ShuValue),
  shu_source: v.optional(v.string()),
  note: v.optional(v.string()),
});

const StepEntry = v.object({
  type: v.picklist(STEP_TYPES),
  date: v.optional(v.nullable(IsoDate), null),
  params: v.optional(
    v.object({
      vessel: v.optional(v.string()),
      vessel_tare_g: v.optional(v.nullable(Num)),
      temp_c: v.optional(v.nullable(Num)),
      minutes: v.optional(v.nullable(Num)),
      removed_g: v.optional(v.nullable(Num)),
    }),
    {},
  ),
  add: v.optional(v.array(AddEntry), []),
});

export const Frontmatter = v.object({
  batch: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.optional(v.nullable(v.string())),
  color: v.optional(v.nullable(v.string())),
  status: v.picklist(BATCH_STATUSES),
  recipe: v.optional(v.nullable(v.string())),
  steps: v.array(StepEntry),
  bottled: v.optional(v.nullable(IsoDate)),
  output: v.optional(
    v.object({
      ph: v.optional(v.nullable(Num)),
      fills: v.optional(v.array(v.object({ bottle: v.string(), ml: Num, count: v.pipe(v.number(), v.integer()) })), []),
      leftover_g: v.optional(v.nullable(Num)),
      total_g: v.optional(v.nullable(Num)),
    }),
  ),
});

export type BatchFile = v.InferOutput<typeof Frontmatter>;

export class ImportError extends Error {}

/** Splits a batch file into its parsed frontmatter and Markdown body. */
export function parseBatchFile(text: string): { frontmatter: BatchFile; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) throw new ImportError('Missing YAML frontmatter between --- lines');
  const result = v.safeParse(Frontmatter, parseYaml(match[1]!));
  if (!result.success) {
    const issues = formatIssues(result.issues).map((i) => `${i.path || '(root)'}: ${i.message}`);
    throw new ImportError(`Invalid frontmatter:\n  ${issues.join('\n  ')}`);
  }
  return { frontmatter: result.output, body: match[2]! };
}

/** The body without the generated `## Timeline` section, which only exports carry. */
export function notesFromBody(body: string): string {
  return body.replace(/^## Timeline[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim();
}

export interface ImportOptions {
  force?: boolean;
  author: string;
  now: string;
}

export type ImportResult = { number: number; result: 'imported' | 'replaced' | 'skipped'; id: string };

export function importBatchFile(db: DB, text: string, opts: ImportOptions): ImportResult {
  const { frontmatter: fm, body } = parseBatchFile(text);
  const meta = { created_at: opts.now, updated_at: opts.now, author: opts.author };
  const audit = { now: opts.now, author: opts.author };

  const existing = db.prepare('SELECT id FROM batches WHERE number = ? AND deleted_at IS NULL').pluck().get(fm.batch) as string | undefined;
  if (existing && !opts.force) return { number: fm.batch, result: 'skipped', id: existing };

  const findOrCreate = (table: string, name: string, extra: Row): string => {
    const id = db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).pluck().get(name) as string | undefined;
    if (id) return id;
    const newId = randomUUID();
    insert(db, table, { id: newId, name, ...extra, ...meta });
    return newId;
  };

  const run = db.transaction((): ImportResult => {
    if (existing) db.prepare('DELETE FROM batches WHERE id = ?').run(existing);
    const batchId = randomUUID();
    const recipeId = fm.recipe
      ? ((db.prepare('SELECT id FROM recipes WHERE name = ? COLLATE NOCASE').pluck().get(fm.recipe) as string | undefined) ??
        null)
      : null;

    const steps = fm.steps.map((s, position) => ({ ...s, position }));
    const auto = autoStatus(steps, fm.bottled ? [{ type: 'bottled' }] : []);
    insert(
      db,
      'batches',
      {
        id: batchId,
        number: fm.batch,
        name: fm.name ?? null,
        color: fm.color ?? null,
        status: fm.status,
        status_manual: fm.status !== auto,
        recipe_id: recipeId,
        notes_md: notesFromBody(body),
        ...meta,
      },
      BATCH_COLS,
    );

    for (const step of steps) {
      const stepId = randomUUID();
      const { vessel, ...rest } = step.params;
      const params = parseStepParams(step.type, {
        ...rest,
        ...(vessel ? { vessel_id: findOrCreate('vessels', vessel, {}) } : {}),
      });
      if (!params.success) throw new ImportError(`Step ${step.position + 1}: invalid params`);
      insert(
        db,
        'steps',
        { id: stepId, batch_id: batchId, position: step.position, type: step.type, date: step.date, params: params.output, ...meta },
        STEP_COLS,
      );
      step.add.forEach((add, position) => {
        insert(db, 'ingredient_lines', {
          id: randomUUID(),
          batch_id: batchId,
          step_id: stepId,
          position,
          local_name: add.local ?? null,
          grams: add.g,
          planned_g: add.planned_g ?? null,
          ...resolveIngredient(add, step.date),
          ...meta,
        });
      });
    }

    if (fm.bottled) {
      const out = fm.output;
      const fills = (out?.fills ?? []).map((f) => ({
        bottle_type_id: findOrCreate('bottle_types', f.bottle, { volume_ml: f.ml }),
        count: f.count,
      }));
      insert(
        db,
        'events',
        {
          id: randomUUID(),
          batch_id: batchId,
          type: 'bottled',
          // Date-only in the file; noon UTC keeps the same calendar day in Europe.
          occurred_at: `${fm.bottled}T12:00:00.000Z`,
          payload: {
            fills,
            ph: out?.ph ?? null,
            ...(out?.leftover_g != null ? { leftover_g: out.leftover_g } : {}),
            ...(out?.total_g != null ? { total_g: out.total_g } : {}),
          },
          ...meta,
        },
        EVENT_COLS,
      );
    }

    return { number: fm.batch, result: existing ? 'replaced' : 'imported', id: batchId };
  });

  type Add = v.InferOutput<typeof AddEntry>;

  /**
   * The catalog item or variety a line refers to, plus the lot and SHU for a
   * pepper. The file's own note is kept as written; an alias adds none, since
   * the file is the original record of the name.
   */
  function resolveIngredient(add: Add, stepDate: string | null): Row {
    const [shuMin, shuMax] =
      add.shu === undefined ? [null, null] : Array.isArray(add.shu) ? add.shu : [add.shu, add.shu];
    const note = add.note ?? null;

    if (add.kind !== 'pepper') {
      const item = findOrCreateEntry(db, 'catalog_items', add.name, add.kind, audit);
      const line: Row = { name: item.name, kind: item.kind, catalog_id: item.id, note };
      return add.shu === undefined ? line : { ...line, shu_min: shuMin, shu_max: shuMax, shu_source: add.shu_source ?? null };
    }

    const variety = findOrCreateEntry(db, 'varieties', add.name, 'pepper', audit);
    const varietyId = variety.id;
    if (add.local) {
      const names = JSON.parse(db.prepare('SELECT local_names FROM varieties WHERE id = ?').pluck().get(varietyId) as string) as string[];
      if (!names.includes(add.local)) {
        update(db, 'varieties', varietyId, { local_names: [...names, add.local], updated_at: opts.now }, { json: ['local_names'] });
      }
    }

    // A legacy per-batch value is an override on the line; a sourced range is
    // reference data for the variety unless the variety already says otherwise.
    let override = add.shu !== undefined;
    if (add.shu !== undefined && add.shu_source !== 'legacy-log') {
      const current = db.prepare('SELECT shu_min, shu_max FROM varieties WHERE id = ?').get(varietyId) as {
        shu_min: number | null;
        shu_max: number | null;
      };
      if (current.shu_min === null && current.shu_max === null) {
        update(db, 'varieties', varietyId, { shu_min: shuMin, shu_max: shuMax, shu_source: add.shu_source ?? null, updated_at: opts.now });
        override = false;
      } else {
        override = current.shu_min !== shuMin || current.shu_max !== shuMax;
      }
    }

    let lotId: string | null = null;
    if (add.lot) {
      const season = add.lot.season ?? (stepDate ? Number(stepDate.slice(0, 4)) : null);
      if (season === null) throw new ImportError(`${add.name}: lot needs a season or a dated step`);
      const lot = {
        variety_id: varietyId,
        season,
        origin: add.lot.origin,
        propagation: add.lot.propagation ?? null,
        supplier: add.lot.supplier ?? null,
        acquired_on: add.lot.acquired ?? null,
      };
      lotId =
        (db
          .prepare(
            `SELECT id FROM pepper_lots WHERE variety_id = ? AND season = ? AND origin = ?
               AND propagation IS ? AND supplier IS ? AND acquired_on IS ?`,
          )
          .pluck()
          .get(lot.variety_id, lot.season, lot.origin, lot.propagation, lot.supplier, lot.acquired_on) as
          | string
          | undefined) ?? null;
      if (!lotId) {
        lotId = randomUUID();
        insert(db, 'pepper_lots', { id: lotId, ...lot, ...meta });
      }
    }

    return {
      name: variety.name,
      kind: 'pepper',
      variety_id: varietyId,
      note,
      lot_id: lotId,
      ...(override ? { shu_min: shuMin, shu_max: shuMax, shu_source: add.shu_source ?? null } : {}),
    };
  }

  return run();
}
