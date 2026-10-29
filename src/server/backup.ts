import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.ts';

/** The nightly snapshots (SPEC §10.2): ferment-YYYYMMDD.db. */
export const NIGHTLY_BACKUP = /^ferment-(\d{4})(\d{2})(\d{2})\.db$/;

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function vacuumInto(db: DB, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  db.prepare('VACUUM INTO ?').run(file);
}

/** Deletes all but the newest `keep` files matching `pattern`, by name. */
function prune(dir: string, pattern: RegExp, keep: number): void {
  const matching = fs
    .readdirSync(dir)
    .filter((f) => pattern.test(f))
    .sort()
    .reverse();
  for (const old of matching.slice(keep)) fs.rmSync(path.join(dir, old));
}

/**
 * Writes a consistent snapshot with VACUUM INTO, then keeps only the newest
 * `keep` files with the same prefix. Returns the snapshot path.
 */
export function snapshot(db: DB, backupsDir: string, prefix: string, keep: number, now = new Date()): string {
  const file = path.join(backupsDir, `${prefix}-${stamp(now)}.db`);
  vacuumInto(db, file);
  prune(backupsDir, new RegExp(`^${prefix}-\\d{8}-\\d{6}\\.db$`), keep);
  return file;
}

/** The nightly snapshot for a local date (YYYY-MM-DD), keeping the newest `keep`. */
export function nightlyBackup(db: DB, backupsDir: string, date: string, keep: number): string {
  const file = path.join(backupsDir, `ferment-${date.replaceAll('-', '')}.db`);
  vacuumInto(db, file);
  prune(backupsDir, NIGHTLY_BACKUP, keep);
  return file;
}

/** The local date of the newest nightly snapshot, if any. */
export function lastNightlyBackup(backupsDir: string): string | null {
  if (!fs.existsSync(backupsDir)) return null;
  const newest = fs
    .readdirSync(backupsDir)
    .filter((f) => NIGHTLY_BACKUP.test(f))
    .sort()
    .at(-1);
  const m = newest ? NIGHTLY_BACKUP.exec(newest) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
