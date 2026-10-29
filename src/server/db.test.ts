import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { snapshot } from './backup.ts';
import { migrate, openDb, readMigrations } from './db.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferment-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrate', () => {
  it('applies the repo migrations once', () => {
    const db = openDb(path.join(dir, 'ferment.db'));
    const applied = migrate(db);
    expect(applied).toEqual(readMigrations().map((m) => m.name));
    expect(migrate(db)).toEqual([]);
    expect(db.prepare("SELECT value FROM settings WHERE key = 'target_salt_pct'").pluck().get()).toBe('3.0');
    db.close();
  });

  it('runs migrations in version order and rolls back a failing one', () => {
    const db = openDb(':memory:');
    const ok = { version: 1, name: '0001_a.sql', sql: 'CREATE TABLE a (x);' };
    const bad = { version: 2, name: '0002_b.sql', sql: 'CREATE TABLE b (x); INSERT INTO nope VALUES (1);' };
    expect(() => migrate(db, [ok, bad])).toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
    expect(tables).toEqual(['a', 'schema_migrations']);
    expect(db.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1]);
  });
});

describe('migrate with foreign keys', () => {
  const parent = { version: 1, name: '0001_p.sql', sql: 'CREATE TABLE p (id PRIMARY KEY); CREATE TABLE c (p_id REFERENCES p (id) ON DELETE CASCADE);' };

  it('lets a migration rebuild a parent table without cascading, then re-enables enforcement', () => {
    const db = openDb(':memory:');
    migrate(db, [parent]);
    db.exec("INSERT INTO p VALUES ('a'); INSERT INTO c VALUES ('a');");
    const rebuild = {
      version: 2,
      name: '0002_rebuild.sql',
      sql: 'CREATE TABLE p2 (id PRIMARY KEY, extra); INSERT INTO p2 (id) SELECT id FROM p; DROP TABLE p; ALTER TABLE p2 RENAME TO p;',
    };
    migrate(db, [parent, rebuild]);
    expect(db.prepare('SELECT COUNT(*) FROM c').pluck().get()).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('refuses a migration that leaves a dangling reference', () => {
    const db = openDb(':memory:');
    migrate(db, [parent]);
    const dangling = { version: 2, name: '0002_bad.sql', sql: "INSERT INTO c VALUES ('missing');" };
    expect(() => migrate(db, [parent, dangling])).toThrow(/broken reference/);
    expect(db.prepare('SELECT COUNT(*) FROM c').pluck().get()).toBe(0);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});

describe('snapshot', () => {
  it('writes a readable copy and keeps only the newest N', () => {
    const db = openDb(path.join(dir, 'ferment.db'));
    migrate(db);
    const backups = path.join(dir, 'backups');
    for (let i = 0; i < 5; i++) {
      snapshot(db, backups, 'ferment-startup', 3, new Date(Date.UTC(2026, 9, 29, 12, 0, i)));
    }
    const files = fs.readdirSync(backups).sort();
    expect(files).toEqual([
      'ferment-startup-20261029-120002.db',
      'ferment-startup-20261029-120003.db',
      'ferment-startup-20261029-120004.db',
    ]);
    const copy = openDb(path.join(backups, files[2]!));
    expect(copy.prepare('SELECT count(*) FROM settings').pluck().get()).toBe(1);
    copy.close();
    db.close();
  });
});
