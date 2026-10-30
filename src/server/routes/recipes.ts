// Recipes (SPEC §7.3, §11). A recipe is saved whole: PATCH with `lines`
// replaces all of them. Lines refer to a variety or catalog item like batch
// lines do, so the heat estimate can use the variety's SHU.
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type * as v from 'valibot';
import { evaluateRecipe, recipeFromBatch, type BatchLineForRecipe, type RecipeLine as EvalLine } from '../../shared/recipe.ts';
import { Recipe, RecipeEvaluate, SaveAsRecipe, type RecipeLine, type StepType } from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import type { DB } from '../db.ts';
import { resolveLine } from '../entries.ts';
import { ApiError, jsonBody, meta, type AppContext } from '../http.ts';
import { getRow, insert, requireRow, update, type Row } from '../store.ts';

type LineBody = v.InferOutput<typeof RecipeLine>;
type Audit = { now: string; author: string };

export function recipeView(db: DB, id: string): (Row & { heat_target_shu: number | null; lines: Row[] }) | undefined {
  const recipe = getRow(db, 'recipes', id);
  if (!recipe) return undefined;
  const lines = (
    db
      .prepare(
        `SELECT l.*, v.shu_min, v.shu_max FROM recipe_lines l
           LEFT JOIN varieties v ON v.id = l.variety_id
          WHERE l.recipe_id = ? ORDER BY l.step_index, l.position, l.created_at`,
      )
      .all(id) as Row[]
  ).map((l) => ({ ...l, solve_for_heat: Boolean(l.solve_for_heat) }));
  return { ...recipe, heat_target_shu: recipe.heat_target_shu as number | null, lines };
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
    const { lines, ...body } = c.req.valid('json');
    if (getRow(db, 'recipes', body.id)) return c.json(view(body.id), 200);
    const audit = meta(ctx, c);
    db.transaction(() => {
      insert(db, 'recipes', { ...body, created_at: audit.now, updated_at: audit.now, author: audit.author });
      writeLines(db, body.id, lines ?? [], audit);
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
    const { lines, ...fields } = c.req.valid('json');
    const audit = meta(ctx, c);
    db.transaction(() => {
      update(db, 'recipes', id, { ...fields, updated_at: audit.now });
      if (lines) writeLines(db, id, lines, audit);
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
      writeLines(db, body.id, recipeFromBatch(steps).map((l) => ({ ...l, id: randomUUID() })), audit);
    })();
    return c.json(view(body.id), 201);
  });

  return r;
}
