// Thin helpers over plain SQL. Column names always come from parsed valibot
// output or from server code, never from raw request keys.
import { ApiError } from './http.ts';
import type { DB } from './db.ts';

export type Row = Record<string, unknown>;

export interface Columns {
  json?: readonly string[];
  bool?: readonly string[];
}

function encode(key: string, value: unknown, cols: Columns): unknown {
  if (cols.json?.includes(key)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function decode(row: Row, cols: Columns): Row {
  const out: Row = { ...row };
  for (const k of cols.json ?? []) if (typeof out[k] === 'string') out[k] = JSON.parse(out[k]);
  for (const k of cols.bool ?? []) if (k in out) out[k] = Boolean(out[k]);
  return out;
}

export function getRow(db: DB, table: string, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
}

export function requireRow(db: DB, table: string, id: string, what: string): Row {
  const row = getRow(db, table, id);
  if (!row) throw new ApiError(404, `${what} not found`);
  return row;
}

export function insert(db: DB, table: string, values: Row, cols: Columns = {}): void {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
    ...keys.map((k) => encode(k, values[k], cols)),
  );
}

export function update(db: DB, table: string, id: string, values: Row, cols: Columns = {}): void {
  const keys = Object.keys(values).filter((k) => values[k] !== undefined);
  if (keys.length === 0) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
    ...keys.map((k) => encode(k, values[k], cols)),
    id,
  );
}

/** The next free position among rows sharing a parent. */
export function nextPosition(db: DB, table: string, parentColumn: string, parentId: string): number {
  const max = db.prepare(`SELECT MAX(position) FROM ${table} WHERE ${parentColumn} = ?`).pluck().get(parentId);
  return typeof max === 'number' ? max + 1 : 0;
}
