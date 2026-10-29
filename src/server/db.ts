import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { DATA_MIGRATIONS } from './data-migrations.ts';

export type DB = Database.Database;

// Resolves to <repo>/migrations from both src/server (tsx) and dist/server (built).
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Runs after the SQL, in the same transaction, for changes SQL can't express. */
  data?: (db: DB) => void;
}

export type DataMigrations = Record<number, (db: DB) => void>;

export function readMigrations(dir: string = MIGRATIONS_DIR, data: DataMigrations = DATA_MIGRATIONS): Migration[] {
  const migrations = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const match = /^(\d+)_.+\.sql$/.exec(f);
      if (!match) throw new Error(`Bad migration file name: ${f} (expected NNNN_name.sql)`);
      const version = Number(match[1]);
      return { version, name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8'), ...(data[version] ? { data: data[version] } : {}) };
    })
    .sort((a, b) => a.version - b.version);

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.version === migrations[i - 1]!.version) {
      throw new Error(`Duplicate migration version ${migrations[i]!.version}`);
    }
  }
  for (const version of Object.keys(data)) {
    if (!migrations.some((m) => m.version === Number(version))) throw new Error(`Data migration ${version} has no .sql file`);
  }
  return migrations;
}

export function pendingMigrations(db: DB, migrations: Migration[] = readMigrations()): Migration[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .pluck()
      .all() as number[],
  );
  return migrations.filter((m) => !applied.has(m.version));
}

/**
 * Applies pending migrations, each in its own transaction. Returns the names applied.
 *
 * Foreign keys are off while they run, so a migration can rebuild a table
 * (create, copy, drop, rename) without the drop cascading into its children.
 * SQLite ignores that pragma inside a transaction, hence the toggle around
 * each one; foreign_key_check then refuses to commit a migration that leaves
 * a dangling reference.
 */
export function migrate(db: DB, migrations: Migration[] = readMigrations()): string[] {
  const pending = pendingMigrations(db, migrations);
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const enforced = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql);
        m.data?.(db);
        const broken = db.pragma('foreign_key_check') as { table: string }[];
        if (broken.length) {
          throw new Error(`${m.name} leaves ${broken.length} broken reference(s), first in ${broken[0]!.table}`);
        }
        record.run(m.version, m.name, new Date().toISOString());
      })();
    }
  } finally {
    if (enforced) db.pragma('foreign_keys = ON');
  }
  return pending.map((m) => m.name);
}
