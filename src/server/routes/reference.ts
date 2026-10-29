// Reference data: GET / POST / PATCH for varieties, lots, catalog items,
// bottle types and vessels (SPEC §11), plus the settings used by derived values.
import { Hono } from 'hono';
import * as v from 'valibot';
import { BottleType, CatalogItem, Lot, Variety, Vessel } from '../../shared/schemas.ts';
import type { AppEnv } from '../auth.ts';
import { clashingEntry, type EntryTable } from '../entries.ts';
import { ApiError, jsonBody, meta, type AppContext } from '../http.ts';
import { decode, getRow, insert, requireRow, update, type Columns, type Row } from '../store.ts';

interface Resource {
  path: string;
  table: string;
  what: string;
  schema: { create: v.GenericSchema; patch: v.GenericSchema };
  cols: Columns;
  order: string;
  /** Ingredient entries (SPEC §15.3): names are unique and lines copy them. */
  entry?: EntryTable;
}

const RESOURCES: Resource[] = [
  { path: 'varieties', table: 'varieties', what: 'Variety', schema: Variety, cols: { json: ['local_names', 'aliases'] }, order: 'name COLLATE NOCASE', entry: 'varieties' },
  { path: 'lots', table: 'pepper_lots', what: 'Lot', schema: Lot, cols: {}, order: 'season DESC, created_at' },
  { path: 'catalog', table: 'catalog_items', what: 'Catalog item', schema: CatalogItem, cols: { json: ['aliases'] }, order: 'name COLLATE NOCASE', entry: 'catalog_items' },
  { path: 'bottle-types', table: 'bottle_types', what: 'Bottle type', schema: BottleType, cols: {}, order: 'name COLLATE NOCASE' },
  { path: 'vessels', table: 'vessels', what: 'Vessel', schema: Vessel, cols: {}, order: 'name COLLATE NOCASE' },
];

const Settings = v.object({
  target_salt_pct: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(30))),
});

export function referenceRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();

  /** A name or alias may answer to one entry only, ignoring case and accents. */
  function requireUniqueNames(table: EntryTable, body: Row, id: string) {
    const names = [...(typeof body.name === 'string' ? [body.name] : []), ...((body.aliases as string[] | undefined) ?? [])];
    const clash = clashingEntry(db, table, names, id);
    if (clash) throw new ApiError(409, `“${clash.name}” already has this name or alias`);
  }

  /** Lines carry a copy of their entry's name and kind. */
  function propagate(table: EntryTable, id: string) {
    const column = table === 'varieties' ? 'variety_id' : 'catalog_id';
    const entry = db.prepare(`SELECT name, ${table === 'varieties' ? "'pepper' AS kind" : 'kind'} FROM ${table} WHERE id = ?`).get(id) as {
      name: string;
      kind: string;
    };
    for (const lines of ['ingredient_lines', 'recipe_lines']) {
      db.prepare(`UPDATE ${lines} SET name = ?, kind = ? WHERE ${column} = ?`).run(entry.name, entry.kind, id);
    }
  }

  for (const res of RESOURCES) {
    const one = (id: string) => decode(getRow(db, res.table, id)!, res.cols);

    r.get(`/${res.path}`, (c) =>
      c.json((db.prepare(`SELECT * FROM ${res.table} ORDER BY ${res.order}`).all() as Row[]).map((row) => decode(row, res.cols))),
    );

    r.post(`/${res.path}`, jsonBody(res.schema.create), (c) => {
      const body = c.req.valid('json') as Row & { id: string };
      if (getRow(db, res.table, body.id)) return c.json(one(body.id), 200);
      if (res.entry) requireUniqueNames(res.entry, body, body.id);
      const { now, author } = meta(ctx, c);
      insert(db, res.table, { ...body, created_at: now, updated_at: now, author }, res.cols);
      return c.json(one(body.id), 201);
    });

    r.patch(`/${res.path}/:id`, jsonBody(res.schema.patch), (c) => {
      const id = c.req.param('id');
      requireRow(db, res.table, id, res.what);
      const body = c.req.valid('json') as Row;
      if (res.entry) requireUniqueNames(res.entry, body, id);
      db.transaction(() => {
        update(db, res.table, id, { ...body, updated_at: meta(ctx, c).now }, res.cols);
        if (res.entry) propagate(res.entry, id);
      })();
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
