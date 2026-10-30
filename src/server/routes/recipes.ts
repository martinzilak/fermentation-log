// Recipes (SPEC §7.3, §11). A recipe is saved whole: PATCH with `steps` or
// `lines` replaces all of them. Lines refer to a variety or catalog item like
// batch lines do, so the heat estimate can use the variety's SHU. A step can
// be empty (a cook, the final strain); a line's step always exists, and takes
// the step's type.
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type * as v from 'valibot';
import { evaluateRecipe, recipeFromBatch, type BatchLineForRecipe, type RecipeLine as EvalLine } from '../../shared/recipe.ts';
import { Recipe, RecipeEvaluate, SaveAsRecipe, type RecipeLine, type RecipeStep, type StepType } from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import type { DB } from '../db.ts';
import { resolveLine } from '../entries.ts';
import { ApiError, jsonBody, meta, type AppContext } from '../http.ts';
import { getRow, insert, requireRow, update, type Row } from '../store.ts';

type LineBody = v.InferOutput<typeof RecipeLine>;
type StepBody = v.InferOutput<typeof RecipeStep>;
type Audit = { now: string; author: string };

export function recipeView(db: DB, id: string): (Row & { heat_target_shu: number | null; steps: Row[]; lines: Row[] }) | undefined {
  const recipe = getRow(db, 'recipes', id);
  if (!recipe) return undefined;
  const steps = db.prepare('SELECT step_index, type, note FROM recipe_steps WHERE recipe_id = ? ORDER BY step_index').all(id) as Row[];
  const lines = (
    db
      .prepare(
        `SELECT l.*, v.shu_min, v.shu_max FROM recipe_lines l
           LEFT JOIN varieties v ON v.id = l.variety_id
          WHERE l.recipe_id = ? ORDER BY l.step_index, l.position, l.created_at`,
      )
      .all(id) as Row[]
  ).map((l) => ({ ...l, solve_for_heat: Boolean(l.solve_for_heat) }));
  return { ...recipe, heat_target_shu: recipe.heat_target_shu as number | null, steps, lines };
}

function writeSteps(db: DB, recipeId: string, steps: StepBody[], audit: Audit) {
  db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(recipeId);
  const add = db.prepare(
    'INSERT INTO recipe_steps (recipe_id, step_index, type, note, created_at, updated_at, author) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const s of steps) add.run(recipeId, s.step_index, s.type, s.note ?? null, audit.now, audit.now, audit.author);
}

/** Adds the steps lines refer to but that don't exist, then gives each line its step's type. */
function settleSteps(db: DB, recipeId: string, audit: Audit) {
  db.prepare(
    `INSERT OR IGNORE INTO recipe_steps (recipe_id, step_index, type, created_at, updated_at, author)
     SELECT recipe_id, step_index, MIN(step_type), ?, ?, ? FROM recipe_lines WHERE recipe_id = ? GROUP BY step_index`,
  ).run(audit.now, audit.now, audit.author, recipeId);
  db.prepare(
    `UPDATE recipe_lines SET step_type = (
       SELECT s.type FROM recipe_steps s WHERE s.recipe_id = recipe_lines.recipe_id AND s.step_index = recipe_lines.step_index)
     WHERE recipe_id = ?`,
  ).run(recipeId);
}

function writeLines(db: DB, recipeId: string, lines: LineBody[], audit: Audit) {
  db.prepare('DELETE FROM recipe_lines WHERE recipe_id = ?').run(recipeId);
  const positions = new Map<number, number>();
  for (const l of lines) {
    const position = l.position ?? positions.get(l.step_index) ?? 0;
    positions.set(l.step_index, position + 1);
    const entry = resolveLine(db, { name: l.name, kind: l.kind, catalog_id: l.catalog_id, variety_id: l.variety_id }, audit);
    insert(db, 'recipe_lines', {
      id: l.id,
      recipe_id: recipeId,
      step_index: l.step_index,
      step_type: l.step_type,
      position,
      name: entry.name,
      kind: entry.kind,
      variety_id: entry.variety_id,
      catalog_id: entry.catalog_id,
      mode: l.mode,
      grams: l.grams ?? null,
      percent: l.mode === 'percent' ? (l.percent ?? null) : null,
      base: l.mode === 'percent' ? (l.base ?? null) : null,
      solve_for_heat: l.solve_for_heat ?? false,
      created_at: audit.now,
      updated_at: audit.now,
      author: audit.author,
    });
  }
}

export function recipeRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();
  const view = (id: string) => recipeView(db, id)!;

  r.get('/recipes', (c) => {
    const ids = db.prepare('SELECT id FROM recipes ORDER BY name COLLATE NOCASE, created_at').pluck().all() as string[];
    return c.json(ids.map(view));
  });

  r.post('/recipes', jsonBody(Recipe.create), (c) => {
    const { steps, lines, ...body } = c.req.valid('json');
    if (getRow(db, 'recipes', body.id)) return c.json(view(body.id), 200);
    const audit = meta(ctx, c);
    db.transaction(() => {
      insert(db, 'recipes', { ...body, created_at: audit.now, updated_at: audit.now, author: audit.author });
      writeSteps(db, body.id, steps ?? [], audit);
      writeLines(db, body.id, lines ?? [], audit);
      settleSteps(db, body.id, audit);
    })();
    return c.json(view(body.id), 201);
  });

  r.get('/recipes/:id', (c) => {
    const id = c.req.param('id');
    requireRow(db, 'recipes', id, 'Recipe');
    return c.json(view(id));
  });

  r.patch('/recipes/:id', jsonBody(Recipe.patch), (c) => {
    const id = c.req.param('id');
    requireRow(db, 'recipes', id, 'Recipe');
    const { steps, lines, ...fields } = c.req.valid('json');
    const audit = meta(ctx, c);
    db.transaction(() => {
      update(db, 'recipes', id, { ...fields, updated_at: audit.now });
      if (steps) writeSteps(db, id, steps, audit);
      if (lines) writeLines(db, id, lines, audit);
      settleSteps(db, id, audit);
    })();
    return c.json(view(id));
  });

  r.post('/recipes/:id/evaluate', jsonBody(RecipeEvaluate), (c) => {
    const id = c.req.param('id');
    requireRow(db, 'recipes', id, 'Recipe');
    const recipe = view(id);
    const body = c.req.valid('json');
    return c.json(
      evaluateRecipe(recipe.lines as unknown as EvalLine[], {
        grams: body.grams,
        mash_g: body.mash_g,
        heat_target_shu: recipe.heat_target_shu,
      }),
    );
  });

  // Under /batches so the client's outbox sends it; the recipe id makes a replay safe.
  r.post('/batches/:id/save-as-recipe', jsonBody(SaveAsRecipe), (c) => {
    const batch = requireRow(db, 'batches', c.req.param('id'), 'Batch');
    if (batch.deleted_at !== null) throw new ApiError(404, 'Batch not found');
    const body = c.req.valid('json');
    if (getRow(db, 'recipes', body.id)) return c.json(view(body.id), 200);
    const steps = (db.prepare('SELECT id, type, position FROM steps WHERE batch_id = ? ORDER BY position, created_at').all(batch.id) as {
      id: string;
      type: StepType;
      position: number;
    }[]).map((s) => ({
      ...s,
      lines: db
        .prepare('SELECT name, kind, grams, variety_id, catalog_id FROM ingredient_lines WHERE step_id = ? ORDER BY position, created_at')
        .all(s.id) as BatchLineForRecipe[],
    }));
    const audit = meta(ctx, c);
    const name = body.name ?? (batch.name as string | null) ?? `Batch #${batch.number as number}`;
    db.transaction(() => {
      insert(db, 'recipes', {
        id: body.id,
        name,
        notes_md: '',
        created_from_batch_id: batch.id,
        created_at: audit.now,
        updated_at: audit.now,
        author: audit.author,
      });
      const draft = recipeFromBatch(steps);
      writeSteps(db, body.id, draft.steps, audit);
      writeLines(db, body.id, draft.lines.map((l) => ({ ...l, id: randomUUID() })), audit);
      settleSteps(db, body.id, audit);
    })();
    return c.json(view(body.id), 201);
  });

  return r;
}
