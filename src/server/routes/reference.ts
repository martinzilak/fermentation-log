// Reference data: GET / POST / PATCH for varieties, lots, catalog items,
// bottle types and vessels (SPEC §11), plus the settings used by derived values.
// Lists carry a `uses` count; an entry can be deleted only while unused, and
// two ingredient entries can be merged (SPEC §15.3).
import { Hono } from 'hono';
import * as v from 'valibot';
import { fold } from '../../shared/names.ts';
import { BottleType, CatalogItem, Id, Lot, Variety, Vessel } from '../../shared/schemas.ts';
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
  /** SQL counting what refers to row `x`; a row in use can't be deleted. */
  uses?: string;
}

const linesOf = (column: string) =>
  `(SELECT COUNT(*) FROM ingredient_lines WHERE ${column} = x.id) + (SELECT COUNT(*) FROM recipe_lines WHERE ${column} = x.id)`;

const RESOURCES: Resource[] = [
  { path: 'varieties', table: 'varieties', what: 'Variety', schema: Variety, cols: { json: ['local_names', 'aliases'] }, order: 'name COLLATE NOCASE', entry: 'varieties',
    uses: `${linesOf('variety_id')} + (SELECT COUNT(*) FROM pepper_lots WHERE variety_id = x.id)` },
  { path: 'lots', table: 'pepper_lots', what: 'Lot', schema: Lot, cols: {}, order: 'season DESC, created_at',
    uses: '(SELECT COUNT(*) FROM ingredient_lines WHERE lot_id = x.id)' },
  { path: 'catalog', table: 'catalog_items', what: 'Catalog item', schema: CatalogItem, cols: { json: ['aliases'] }, order: 'name COLLATE NOCASE', entry: 'catalog_items',
    uses: linesOf('catalog_id') },
  { path: 'bottle-types', table: 'bottle_types', what: 'Bottle type', schema: BottleType, cols: {}, order: 'name COLLATE NOCASE',
    uses: `(SELECT COUNT(*) FROM events e, json_each(e.payload, '$.fills') f
             WHERE e.type = 'bottled' AND json_extract(f.value, '$.bottle_type_id') = x.id)` },
  { path: 'vessels', table: 'vessels', what: 'Vessel', schema: Vessel, cols: {}, order: 'name COLLATE NOCASE' },
];

const Settings = v.object({
  target_salt_pct: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(30))),
});

export function referenceRoutes(ctx: AppContext) {
  const { db } = ctx;
  const r = new Hono<AppEnv>();

  const one = (table: string, id: string) =>
    decode(getRow(db, table, id)!, RESOURCES.find((res) => res.table === table)!.cols);

  /** A name or alias may answer to one entry only, ignoring case and accents. */
  function requireUniqueNames(table: EntryTable, body: Row, id: string) {
    const names = [...(typeof body.name === 'string' ? [body.name] : []), ...((body.aliases as string[] | undefined) ?? [])];
    const clash = clashingEntry(db, table, names, id);
    if (clash) throw new ApiError(409, `“${clash.name}” already has this name or alias`);
  }

  /** Lines carry a copy of their entry's name and kind. */
  function propagate(table: EntryTable | 'pepper_lots', id: string) {
    if (table === 'pepper_lots') {
      // A lot moved to another variety takes its lines with it.
      db.prepare(
        `UPDATE ingredient_lines SET variety_id = (SELECT variety_id FROM pepper_lots WHERE id = ?),
                name = (SELECT v.name FROM pepper_lots l JOIN varieties v ON v.id = l.variety_id WHERE l.id = ?)
          WHERE lot_id = ?`,
      ).run(id, id, id);
      return;
    }
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
    const select = `SELECT x.*${res.uses ? `, ${res.uses} AS uses` : ''} FROM ${res.table} x`;
    const one = (id: string) => decode(db.prepare(`${select} WHERE x.id = ?`).get(id) as Row, res.cols);

    r.get(`/${res.path}`, (c) =>
      c.json((db.prepare(`${select} ORDER BY ${res.order}`).all() as Row[]).map((row) => decode(row, res.cols))),
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
        if (res.table === 'pepper_lots' && body.variety_id !== undefined) propagate('pepper_lots', id);
      })();
      return c.json(one(id));
    });

    if (!res.uses) continue;
    r.delete(`/${res.path}/:id`, (c) => {
      const row = db.prepare(`${select} WHERE x.id = ?`).get(c.req.param('id')) as (Row & { uses: number }) | undefined;
      if (row && row.uses > 0) throw new ApiError(409, `${res.what} is in use; merge it instead`);
      if (row) db.prepare(`DELETE FROM ${res.table} WHERE id = ?`).run(row.id);
      return c.body(null, 204);
    });
  }

  // Merging keeps `into`: the other entry's lines (and a variety's lots) move
  // to it, its names become aliases, and it is deleted.
  for (const [path, table, what] of [
    ['catalog', 'catalog_items', 'Catalog item'],
    ['varieties', 'varieties', 'Variety'],
  ] as const) {
    const column = table === 'varieties' ? 'variety_id' : 'catalog_id';
    r.post(`/${path}/:id/merge`, jsonBody(v.object({ into: Id })), (c) => {
      const from = requireRow(db, table, c.req.param('id'), what);
      const into = requireRow(db, table, c.req.valid('json').into, what);
      if (from.id === into.id) throw new ApiError(400, 'An entry cannot be merged into itself');
      const names = [...(JSON.parse(into.aliases as string) as string[]), from.name as string, ...(JSON.parse(from.aliases as string) as string[])];
      const seen = new Set([fold(into.name as string)]);
      const aliases = names.filter((n) => !seen.has(fold(n)) && seen.add(fold(n)));
      const { now } = meta(ctx, c);
      db.transaction(() => {
        for (const lines of ['ingredient_lines', 'recipe_lines']) {
          db.prepare(`UPDATE ${lines} SET ${column} = ? WHERE ${column} = ?`).run(into.id, from.id);
        }
        const values: Row = { aliases, updated_at: now };
        if (table === 'varieties') {
          db.prepare('UPDATE pepper_lots SET variety_id = ? WHERE variety_id = ?').run(into.id, from.id);
          if (into.shu_min === null && into.shu_max === null) {
            Object.assign(values, { shu_min: from.shu_min, shu_max: from.shu_max, shu_source: from.shu_source });
          }
        }
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(from.id);
        update(db, table, into.id as string, values, { json: ['aliases'] });
        propagate(table, into.id as string);
      })();
      return c.json(one(table, into.id as string));
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
