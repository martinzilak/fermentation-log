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
    if (getRow(db, 'batches', body.id)) return c.json(batchView(body.id), 200);
    const { now, author } = meta(ctx, c);
    const number = body.number ?? (db.prepare('SELECT COALESCE(MAX(number), 0) + 1 FROM batches').pluck().get() as number);
    insert(db, 'batches', { ...body, number, created_at: now, updated_at: now, author }, BATCH_COLS);
    return c.json(batchView(body.id), 201);
  });

  r.get('/batches/:id', (c) => {
    const batch = batchView(c.req.param('id'));
    if (!batch) throw new ApiError(404, 'Batch not found');
    return c.json(batch);
  });

  r.patch('/batches/:id', jsonBody(BatchPatch), (c) => {
    const id = c.req.param('id');
    requireRow(db, 'batches', id, 'Batch');
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

  // --- Steps ---

  r.post('/batches/:id/steps', jsonBody(Step.create), (c) => {
    const batchId = c.req.param('id');
    requireRow(db, 'batches', batchId, 'Batch');
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

  r.post('/steps/:id/lines', jsonBody(Line.create), (c) => {
    const step = requireRow(db, 'steps', c.req.param('id'), 'Step');
    const body = c.req.valid('json');
    if (getRow(db, 'ingredient_lines', body.id)) return c.json(lineView(body.id), 200);
    const { now, author } = meta(ctx, c);
    insert(db, 'ingredient_lines', {
      ...body,
      batch_id: step.batch_id,
      step_id: step.id,
      position: body.position ?? nextPosition(db, 'ingredient_lines', 'step_id', step.id as string),
      created_at: now,
      updated_at: now,
      author,
    });
    return c.json(lineView(body.id), 201);
  });

  r.patch('/lines/:id', jsonBody(Line.patch), (c) => {
    const id = c.req.param('id');
    requireRow(db, 'ingredient_lines', id, 'Line');
    update(db, 'ingredient_lines', id, { ...c.req.valid('json'), updated_at: meta(ctx, c).now });
    return c.json(lineView(id));
  });

  r.delete('/lines/:id', (c) => {
    db.prepare('DELETE FROM ingredient_lines WHERE id = ?').run(c.req.param('id'));
    return c.body(null, 204);
  });

  // --- Events ---

  r.post('/batches/:id/events', jsonBody(Event.create), (c) => {
    const batchId = c.req.param('id');
    requireRow(db, 'batches', batchId, 'Batch');
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
