// Ingredient entries (SPEC §15.3): every line refers to one catalog item or,
// for a pepper, one variety, and carries a copy of its name. A name finds its
// entry by name first, then by alias, ignoring case and accents; a name that
// finds nothing creates a new entry.
import { randomUUID } from 'node:crypto';
import { cleanName, fold } from '../shared/names.ts';
import type { Kind } from '../shared/schemas.ts';
import type { DB } from './db.ts';
import { ApiError } from './http.ts';
import { insert } from './store.ts';

export type EntryTable = 'catalog_items' | 'varieties';

export interface Entry {
  id: string;
  name: string;
  kind: Kind;
  aliases: string[];
}

interface Audit {
  now: string;
  author: string;
}

function entries(db: DB, table: EntryTable): Entry[] {
  const kind = table === 'varieties' ? "'pepper' AS kind" : 'kind';
  const rows = db.prepare(`SELECT id, name, ${kind}, aliases FROM ${table}`).all() as (Omit<Entry, 'aliases'> & {
    aliases: string;
  })[];
  return rows.map((r) => ({ ...r, aliases: JSON.parse(r.aliases) as string[] }));
}

export function getEntry(db: DB, table: EntryTable, id: string): Entry | undefined {
  return entries(db, table).find((e) => e.id === id);
}

export function findEntry(db: DB, table: EntryTable, name: string): Entry | undefined {
  const key = fold(name);
  const all = entries(db, table);
  return all.find((e) => fold(e.name) === key) ?? all.find((e) => e.aliases.some((a) => fold(a) === key));
}

/** The entry other than `exceptId` that already answers to one of these names. */
export function clashingEntry(db: DB, table: EntryTable, names: string[], exceptId?: string): Entry | undefined {
  const keys = new Set(names.map(fold));
  return entries(db, table).find((e) => e.id !== exceptId && [e.name, ...e.aliases].some((n) => keys.has(fold(n))));
}

export function findOrCreateEntry(db: DB, table: EntryTable, name: string, kind: Kind, audit: Audit): Entry {
  const found = findEntry(db, table, name);
  if (found) return found;
  const entry: Entry = { id: randomUUID(), name: cleanName(name), kind, aliases: [] };
  insert(
    db,
    table,
    {
      id: entry.id,
      name: entry.name,
      ...(table === 'catalog_items' ? { kind } : {}),
      aliases: entry.aliases,
      created_at: audit.now,
      updated_at: audit.now,
      author: audit.author,
    },
    { json: ['aliases'] },
  );
  return entry;
}

export interface LineIdentity {
  name: string;
  kind: Kind;
  catalog_id?: string | null | undefined;
  variety_id?: string | null | undefined;
  lot_id?: string | null | undefined;
}

export interface ResolvedLine {
  name: string;
  kind: Kind;
  catalog_id: string | null;
  variety_id: string | null;
  lot_id: string | null;
}

const invalid = (path: string, message: string) => new ApiError(400, 'Invalid request', [{ path, message }]);

/**
 * The entry a line refers to. An id wins over the name, and a lot fixes the
 * variety. The entry's name and kind replace the line's.
 */
export function resolveLine(db: DB, line: LineIdentity, audit: Audit): ResolvedLine {
  const lotVariety = line.lot_id
    ? (db.prepare('SELECT variety_id FROM pepper_lots WHERE id = ?').pluck().get(line.lot_id) as string | undefined)
    : undefined;
  if (line.lot_id && !lotVariety) throw invalid('lot_id', 'Unknown lot');
  if (lotVariety && line.variety_id && lotVariety !== line.variety_id) throw invalid('lot_id', 'The lot is of another variety');

  const varietyId = lotVariety ?? line.variety_id;
  if (varietyId || line.kind === 'pepper') {
    const variety = varietyId ? getEntry(db, 'varieties', varietyId) : findOrCreateEntry(db, 'varieties', line.name, 'pepper', audit);
    if (!variety) throw invalid('variety_id', 'Unknown variety');
    return { name: variety.name, kind: 'pepper', catalog_id: null, variety_id: variety.id, lot_id: line.lot_id ?? null };
  }

  const item = line.catalog_id
    ? getEntry(db, 'catalog_items', line.catalog_id)
    : findOrCreateEntry(db, 'catalog_items', line.name, line.kind, audit);
  if (!item) throw invalid('catalog_id', 'Unknown catalog item');
  return { name: item.name, kind: item.kind, catalog_id: item.id, variety_id: null, lot_id: null };
}

/** Points every line at its entry, creating entries for names that have none. */
export function linkLines(db: DB): void {
  const audit = { now: new Date().toISOString(), author: 'system' };
  const lines = db.prepare('SELECT id, name, kind, catalog_id, variety_id, lot_id FROM ingredient_lines').all() as (LineIdentity & {
    id: string;
  })[];
  const set = db.prepare('UPDATE ingredient_lines SET name = ?, kind = ?, catalog_id = ?, variety_id = ?, lot_id = ? WHERE id = ?');
  for (const line of lines) {
    const r = resolveLine(db, line, audit);
    set.run(r.name, r.kind, r.catalog_id, r.variety_id, r.lot_id, line.id);
  }
}
