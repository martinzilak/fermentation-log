import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.ts';

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Writes a consistent snapshot with VACUUM INTO, then keeps only the newest
 * `keep` files with the same prefix. Returns the snapshot path.
 */
export function snapshot(db: DB, backupsDir: string, prefix: string, keep: number, now = new Date()): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, `${prefix}-${stamp(now)}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.prepare('VACUUM INTO ?').run(file);

  const mine = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const old of mine.slice(keep)) fs.rmSync(path.join(backupsDir, old));
  return file;
}
