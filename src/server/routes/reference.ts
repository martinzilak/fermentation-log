// Reference data: GET / POST / PATCH for varieties, lots, catalog items,
// bottle types and vessels (SPEC §11), plus the settings used by derived values.
import { Hono } from 'hono';
import * as v from 'valibot';
import { BottleType, CatalogItem, Lot, Variety, Vessel } from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import { jsonBody, meta, type AppContext } from '../http.ts';
import { decode, getRow, insert, requireRow, update, type Columns, type Row } from '../store.ts';

interface Resource {
  path: string;
  table: string;
  what: string;
  schema: { create: v.GenericSchema; patch: v.GenericSchema };
  cols: Columns;
  order: string;
}

const RESOURCES: Resource[] = [
  { path: 'varieties', table: 'varieties', what: 'Variety', schema: Variety, cols: { json: ['local_names'] }, order: 'name COLLATE NOCASE' },
  { path: 'lots', table: 'pepper_lots', what: 'Lot', schema: Lot, cols: {}, order: 'season DESC, created_at' },
  { path: 'catalog', table: 'catalog_items', what: 'Catalog item', schema: CatalogItem, cols: { json: ['aliases'] }, order: 'name COLLATE NOCASE' },
  { path: 'bottle-types', table: 'bottle_types', what: 'Bottle type', schema: BottleType, cols: {}, order: 'name COLLATE NOCASE' },
  { path: 'vessels', table: 'vessels', what: 'Vessel', schema: Vessel, cols: {}, order: 'name COLLATE NOCASE' },
];

const Settings = v.object({
  target_salt_pct: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(30))),
});

export function referenceRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();

  for (const res of RESOURCES) {
    const one = (id: string) => decode(getRow(db, res.table, id)!, res.cols);

    r.get(`/${res.path}`, (c) =>
      c.json((db.prepare(`SELECT * FROM ${res.table} ORDER BY ${res.order}`).all() as Row[]).map((row) => decode(row, res.cols))),
    );

    r.post(`/${res.path}`, jsonBody(res.schema.create), (c) => {
      const body = c.req.valid('json') as Row & { id: string };
      if (getRow(db, res.table, body.id)) return c.json(one(body.id), 200);
      const { now, author } = meta(ctx, c);
      insert(db, res.table, { ...body, created_at: now, updated_at: now, author }, res.cols);
      return c.json(one(body.id), 201);
    });

    r.patch(`/${res.path}/:id`, jsonBody(res.schema.patch), (c) => {
      const id = c.req.param('id');
      requireRow(db, res.table, id, res.what);
      update(db, res.table, id, { ...(c.req.valid('json') as Row), updated_at: meta(ctx, c).now }, res.cols);
      return c.json(one(id));
    });
  }

  const settings = () =>
    Object.fromEntries(
      (db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]).map((s) => [
        s.key,
        Number(s.value),
      ]),
    );

  r.get('/settings', (c) => c.json(settings()));

  r.patch('/settings', jsonBody(Settings), (c) => {
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    );
    for (const [key, value] of Object.entries(c.req.valid('json'))) {
      if (value !== undefined) upsert.run(key, String(value));
    }
    return c.json(settings());
  });

  return r;
}
