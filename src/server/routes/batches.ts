// Batches, steps, ingredient lines and timeline events (SPEC §11).
// Every POST takes the client-generated id; repeating it returns the
// existing record with 200, so the offline outbox can replay safely.
// DELETEs return 204 even when the row is already gone, for the same reason.
import { Hono } from 'hono';
import {
  Batch,
  BatchPatch,
  Event,
  EventPatch,
  Line,
  Step,
  parseEventPayload,
  parseStepParams,
  type EventType,
  type StepType,
} from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import { BATCH_COLS, EVENT_COLS, STEP_COLS, listBatches, loadBatch, refreshStatus } from '../batch-view.ts';
import { resolveLine, type ResolvedLine } from '../entries.ts';
import { ApiError, check, jsonBody, meta, type AppContext } from '../http.ts';
import { decode, getRow, insert, nextPosition, requireRow, update, type Row } from '../store.ts';

export function batchRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();
  const view = () => ({ timeZone: ctx.config.timeZone, now: ctx.now() });

  const batchView = (id: string) => loadBatch(db, id, view());
  const stepView = (id: string) => decode(getRow(db, 'steps', id)!, STEP_COLS);
  const lineView = (id: string) => getRow(db, 'ingredient_lines', id)!;
  const eventView = (id: string) => ({
    ...decode(getRow(db, 'events', id)!, EVENT_COLS),
    attachments: db.prepare('SELECT * FROM attachments WHERE event_id = ? ORDER BY created_at').all(id),
  });

  /** A batch that hasn't been deleted; a deleted one is gone as far as the API is concerned. */
  function requireBatch(id: string): Row {
    const batch = requireRow(db, 'batches', id, 'Batch');
    if (batch.deleted_at !== null) throw new ApiError(404, 'Batch not found');
    return batch;
  }

  function requireStepInBatch(stepId: string | null | undefined, batchId: string) {
    if (!stepId) return;
    const step = getRow(db, 'steps', stepId);
    if (!step || step.batch_id !== batchId) {
      throw new ApiError(400, 'Invalid request', [{ path: 'step_id', message: 'Step is not part of this batch' }]);
    }
  }

  // --- Batches ---

  r.get('/batches', (c) => c.json(listBatches(db, view())));

  r.post('/batches', jsonBody(Batch.create), (c) => {
    const body = c.req.valid('json');
    if (getRow(db, 'batches', body.id)) {
      requireBatch(body.id);
      return c.json(batchView(body.id), 200);
    }
    const { now, author } = meta(ctx, c);
    const number =
      body.number ??
      (db.prepare('SELECT COALESCE(MAX(number), 0) + 1 FROM batches WHERE deleted_at IS NULL').pluck().get() as number);
    insert(db, 'batches', { ...body, number, created_at: now, updated_at: now, author }, BATCH_COLS);
    return c.json(batchView(body.id), 201);
  });

  r.get('/batches/:id', (c) => {
    const id = c.req.param('id');
    requireBatch(id);
    return c.json(batchView(id));
  });

  r.patch('/batches/:id', jsonBody(BatchPatch), (c) => {
    const id = c.req.param('id');
    requireBatch(id);
    const { status, ...fields } = c.req.valid('json');
    const { now } = meta(ctx, c);
    const values: Row = { ...fields, updated_at: now };
    if (status === null) values.status_manual = false;
    else if (status !== undefined) Object.assign(values, { status, status_manual: true });
    db.transaction(() => {
      update(db, 'batches', id, values, BATCH_COLS);
      if (status === null) refreshStatus(db, id, now);
    })();
    return c.json(batchView(id));
  });

  // Undo of a new batch, and the edit screen. A soft delete (SPEC §15.2): the
  // rows stay so the restore below can bring the batch back. A finished batch
  // is archived rather than deleted.
  r.delete('/batches/:id', (c) => {
    const batch = getRow(db, 'batches', c.req.param('id'));
    if (batch && batch.deleted_at === null) {
      if (batch.status === 'bottled' || batch.status === 'archived') {
        throw new ApiError(409, 'A bottled or archived batch cannot be deleted');
      }
      const { now } = meta(ctx, c);
      db.prepare('UPDATE batches SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, batch.id);
    }
    return c.body(null, 204);
  });

  // Undo of a delete. Fails with 409 if a new batch has taken its number since.
  r.post('/batches/:id/restore', (c) => {
    const batch = requireRow(db, 'batches', c.req.param('id'), 'Batch');
    if (batch.deleted_at !== null) {
      const taken = db.prepare('SELECT 1 FROM batches WHERE number = ? AND deleted_at IS NULL').get(batch.number);
      if (taken) throw new ApiError(409, `Batch #${batch.number} exists again`);
      db.prepare('UPDATE batches SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(meta(ctx, c).now, batch.id);
    }
    return c.json(batchView(batch.id as string));
  });

  // --- Steps ---

  r.post('/batches/:id/steps', jsonBody(Step.create), (c) => {
    const batchId = c.req.param('id');
    requireBatch(batchId);
    const body = c.req.valid('json');
    if (getRow(db, 'steps', body.id)) return c.json(stepView(body.id), 200);
    const params = check(parseStepParams(body.type, body.params), 'params');
    const { now, author } = meta(ctx, c);
    db.transaction(() => {
      insert(
        db,
        'steps',
        {
          ...body,
          params,
          batch_id: batchId,
          position: body.position ?? nextPosition(db, 'steps', 'batch_id', batchId),
          created_at: now,
          updated_at: now,
          author,
        },
        STEP_COLS,
      );
      refreshStatus(db, batchId, now);
    })();
    return c.json(stepView(body.id), 201);
  });

  r.patch('/steps/:id', jsonBody(Step.patch), (c) => {
    const id = c.req.param('id');
    const existing = decode(requireRow(db, 'steps', id, 'Step'), STEP_COLS);
    const body = c.req.valid('json');
    const type = (body.type ?? existing.type) as StepType;
    const params =
      body.type !== undefined || body.params !== undefined
        ? check(parseStepParams(type, body.params ?? existing.params), 'params')
        : undefined;
    const { now } = meta(ctx, c);
    db.transaction(() => {
      update(db, 'steps', id, { ...body, params, updated_at: now }, STEP_COLS);
      refreshStatus(db, existing.batch_id as string, now);
    })();
    return c.json(stepView(id));
  });

  r.delete('/steps/:id', (c) => {
    const step = getRow(db, 'steps', c.req.param('id'));
    if (step) {
      const { now } = meta(ctx, c);
      db.transaction(() => {
        db.prepare('DELETE FROM steps WHERE id = ?').run(step.id);
        refreshStatus(db, step.batch_id as string, now);
      })();
    }
    return c.body(null, 204);
  });

  // --- Ingredient lines ---
  // A line refers to a catalog item or a variety (SPEC §15.3): the ids sent
  // win, else the name finds or creates the entry, whose name and kind the
  // line then carries.

  r.post('/steps/:id/lines', jsonBody(Line.create), (c) => {
    const step = requireRow(db, 'steps', c.req.param('id'), 'Step');
    const body = c.req.valid('json');
    if (getRow(db, 'ingredient_lines', body.id)) return c.json(lineView(body.id), 200);
    const { now, author } = meta(ctx, c);
    db.transaction(() => {
      insert(db, 'ingredient_lines', {
        ...body,
        ...resolveLine(db, body, { now, author }),
        batch_id: step.batch_id,
        step_id: step.id,
        position: body.position ?? nextPosition(db, 'ingredient_lines', 'step_id', step.id as string),
        created_at: now,
        updated_at: now,
        author,
      });
    })();
    return c.json(lineView(body.id), 201);
  });

  // Names for the ingredient chips (SPEC §8.1 item 12): the latest use of each
  // entry, most recent first, with the step types it went into, so a step can offer its usual ingredients first.
  r.get('/lines/recent', (c) => {
    const rows = db
      .prepare(
        `SELECT l.name, l.kind, l.catalog_id, l.variety_id, MAX(l.created_at) AS last_used,
                json_group_array(DISTINCT s.type) AS step_types
           FROM ingredient_lines l
           JOIN steps s ON s.id = l.step_id
           JOIN batches b ON b.id = l.batch_id AND b.deleted_at IS NULL
          GROUP BY l.catalog_id, l.variety_id
          ORDER BY last_used DESC
          LIMIT 40`,
      )
      .all() as (Row & { step_types: string })[];
    return c.json(rows.map((row) => ({ ...row, step_types: JSON.parse(row.step_types) as string[] })));
  });

  // Sending a name or an entry id moves the line to that entry; sending only
  // a lot or a kind keeps the entry where it can.
  r.patch('/lines/:id', jsonBody(Line.patch), (c) => {
    const id = c.req.param('id');
    const existing = requireRow(db, 'ingredient_lines', id, 'Line') as Row & ResolvedLine;
    const body = c.req.valid('json');
    const { now, author } = meta(ctx, c);
    const moved = body.name !== undefined || body.catalog_id !== undefined || body.variety_id !== undefined;
    const kind = body.kind ?? existing.kind;
    const keepEntry = !moved && kind === existing.kind;
    const identity =
      moved || body.kind !== undefined || body.lot_id !== undefined
        ? resolveLine(
            db,
            {
              name: body.name ?? existing.name,
              kind,
              catalog_id: moved ? body.catalog_id : keepEntry ? existing.catalog_id : null,
              variety_id: moved ? body.variety_id : keepEntry ? existing.variety_id : null,
              lot_id: body.lot_id !== undefined ? body.lot_id : keepEntry ? existing.lot_id : null,
            },
            { now, author },
          )
        : {};
    db.transaction(() => update(db, 'ingredient_lines', id, { ...body, ...identity, updated_at: now }))();
    return c.json(lineView(id));
  });

  r.delete('/lines/:id', (c) => {
    db.prepare('DELETE FROM ingredient_lines WHERE id = ?').run(c.req.param('id'));
    return c.body(null, 204);
  });

  // --- Events ---

  r.post('/batches/:id/events', jsonBody(Event.create), (c) => {
    const batchId = c.req.param('id');
    requireBatch(batchId);
    const body = c.req.valid('json');
    if (getRow(db, 'events', body.id)) return c.json(eventView(body.id), 200);
    requireStepInBatch(body.step_id, batchId);
    const payload = check(parseEventPayload(body.type, body.payload), 'payload');
    const { now, author } = meta(ctx, c);
    db.transaction(() => {
      insert(
        db,
        'events',
        {
          ...body,
          payload,
          batch_id: batchId,
          occurred_at: body.occurred_at ?? now,
          created_at: now,
          updated_at: now,
          author,
        },
        EVENT_COLS,
      );
      refreshStatus(db, batchId, now);
    })();
    return c.json(eventView(body.id), 201);
  });

  r.patch('/events/:id', jsonBody(EventPatch), (c) => {
    const id = c.req.param('id');
    const existing = requireRow(db, 'events', id, 'Event');
    const body = c.req.valid('json');
    requireStepInBatch(body.step_id, existing.batch_id as string);
    const payload =
      body.payload !== undefined
        ? check(parseEventPayload(existing.type as EventType, body.payload), 'payload')
        : undefined;
    update(db, 'events', id, { ...body, payload, updated_at: meta(ctx, c).now }, EVENT_COLS);
    return c.json(eventView(id));
  });

  // Attachment files stay on disk when their event is deleted, so a mistaken
  // delete never loses a photo or voice note.
  r.delete('/events/:id', (c) => {
    const event = getRow(db, 'events', c.req.param('id'));
    if (event) {
      const { now } = meta(ctx, c);
      db.transaction(() => {
        db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
        refreshStatus(db, event.batch_id as string, now);
      })();
    }
    return c.body(null, 204);
  });

  return r;
}
