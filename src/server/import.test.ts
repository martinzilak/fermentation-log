import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBatch } from './batch-view.ts';
import { migrate, openDb, type DB } from './db.ts';
import { ImportError, importBatchFile, notesFromBody } from './import.ts';

const SEED_DIR = fileURLToPath(new URL('../../seed', import.meta.url));
const seed = (n: number) => fs.readFileSync(path.join(SEED_DIR, `batch-00${n}.md`), 'utf8');
const opts = { author: 'import', now: '2026-10-29T10:00:00.000Z' };
const view = { timeZone: 'Europe/Bratislava', now: new Date('2026-10-29T10:00:00Z') };

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
  migrate(db);
});
afterEach(() => db.close());

function importSeeds() {
  return [1, 2, 3, 4].map((n) => importBatchFile(db, seed(n), opts));
}

function batch(number: number) {
  const id = db.prepare('SELECT id FROM batches WHERE number = ?').pluck().get(number) as string;
  return loadBatch(db, id, view)!;
}

describe('seed import (SPEC §7.2 acceptance values)', () => {
  beforeEach(importSeeds);

  it('reproduces salt % for batches 1–4', () => {
    expect([1, 2, 3, 4].map((n) => batch(n).derived.salt_pct!.toFixed(2))).toEqual(['3.00', '2.96', '3.04', '2.97']);
  });

  it('reproduces ferment days for batches 1–4', () => {
    expect([1, 2, 3, 4].map((n) => batch(n).derived.ferment_days)).toEqual([20, 17, 22, 19]);
  });

  it('reproduces the batch 4 xanthan % and shows none for batches without mash', () => {
    expect(batch(4).derived.xanthan_pct!.toFixed(3)).toBe('0.042');
    expect([1, 2, 3].map((n) => batch(n).derived.xanthan_pct)).toEqual([null, null, null]);
  });

  it('imports every batch as bottled, with its colour, notes and steps', () => {
    const b4 = batch(4);
    expect(b4).toMatchObject({ number: 4, color: 'orange', status: 'bottled', status_manual: false });
    expect(b4.notes_md).toBe('## Notes\nTranscribed from the paper notebook. All peppers are from the 2025 home harvest.\n\n## Tasting');
    expect(b4.steps.map((s) => s.type)).toEqual(['ferment', 'blend']);
    expect(b4.steps[0]!.params).toEqual({ vessel_tare_g: 1669 });
    expect(b4.events).toHaveLength(1);
    expect(b4.events[0]).toMatchObject({ type: 'bottled', occurred_at: '2026-01-06T12:00:00.000Z' });
  });

  it('stores sourced SHU ranges on the variety and legacy values on the line', () => {
    const sparkler = db.prepare("SELECT * FROM varieties WHERE name = 'Sparkler'").get() as Record<string, unknown>;
    expect(sparkler).toMatchObject({ shu_min: null, shu_max: 160000, local_names: '["špicaté"]' });
    const cayenne = batch(1).steps[0]!.lines[0]!;
    expect(cayenne).toMatchObject({ name: 'Cayenne', shu_min: 30000, shu_max: 30000, shu_source: 'legacy-log' });
    expect(batch(4).steps[0]!.lines[1]!.shu).toEqual({
      min: null,
      max: 160000,
      source: 'https://www.chilli-shop.sk/sparkler-82551.html',
    });
  });

  it('gives batch 4 a heat range from the variety SHU values', () => {
    const heat = batch(4).derived.heat!;
    expect(Math.round(heat.low)).toBe(17279);
    expect(Math.round(heat.high)).toBe(50045);
  });

  it('lists batch 3 peppers without SHU in the heat estimate', () => {
    expect(batch(3).derived.heat!.unknown).toEqual(['California Red', 'Palermo Red', 'Sweet Amy White', 'Kapia Red']);
  });

  it('creates one lot per variety and source, reusing it across batches', () => {
    // The seed's varieties; those only the 2026 recipes use (migration 0006) are left out.
    expect(db.prepare("SELECT COUNT(*) FROM varieties WHERE author <> 'system' OR id IN (SELECT variety_id FROM ingredient_lines)").pluck().get()).toBe(13);
    expect(db.prepare('SELECT COUNT(*) FROM pepper_lots').pluck().get()).toBe(13);
    const lot = db
      .prepare("SELECT l.* FROM pepper_lots l JOIN varieties v ON v.id = l.variety_id WHERE v.name = 'Habanero Yellow'")
      .get();
    expect(lot).toMatchObject({ season: 2025, origin: 'grown', propagation: 'sapling', acquired_on: '2025-03-28' });
  });

  it('links the vinegar line to the catalog item', () => {
    const vinegar = batch(4).steps[1]!.lines.find((l) => l.name === 'Spirit vinegar 8 %')!;
    expect(vinegar.catalog_id).toBe('0cc364e2-813e-4b83-8b6d-41b8fb7d9272');
    expect(vinegar.note).toBe("recorded as 'ocot'");
  });

  it('maps the Slovak names to the English entries and links every line to one', () => {
    expect(batch(1).steps[0]!.lines.map((l) => l.name)).toEqual(['Cayenne', 'Jalapeño Red', 'Garlic', 'Water', 'Salt']);
    expect(db.prepare('SELECT COUNT(*) FROM ingredient_lines WHERE catalog_id IS NULL AND variety_id IS NULL').pluck().get()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) FROM ingredient_lines WHERE name = 'Red onion'").pluck().get()).toBe(2);
    const created = db.prepare("SELECT name, kind FROM catalog_items WHERE author = 'import' ORDER BY name").all();
    // Brine came with the 2026 recipes (migration 0006).
    expect(created).toEqual([{ name: 'Mash', kind: 'mash' }]);
  });
});

describe('import behaviour', () => {
  it('skips existing batch numbers unless forced', () => {
    importSeeds();
    expect(importBatchFile(db, seed(1), opts).result).toBe('skipped');
    expect(importBatchFile(db, seed(1), { ...opts, force: true }).result).toBe('replaced');
    expect(db.prepare('SELECT COUNT(*) FROM batches').pluck().get()).toBe(4);
    expect(db.prepare('SELECT COUNT(*) FROM steps').pluck().get()).toBe(8);
    expect(db.prepare('SELECT COUNT(*) FROM pepper_lots').pluck().get()).toBe(13);
  });

  it('resolves a bare alias to the canonical catalog name', () => {
    const file = `---
batch: 9
status: fermenting
steps:
  - type: ferment
    date: 2026-10-20
    add:
      - { name: ocot, kind: acid, g: 50 }
---
`;
    importBatchFile(db, file, opts);
    const line = batch(9).steps[0]!.lines[0]!;
    expect(line).toMatchObject({ name: 'Spirit vinegar 8 %', catalog_id: '0cc364e2-813e-4b83-8b6d-41b8fb7d9272', note: null });
  });

  it('keeps a status that differs from the automatic one as a manual override', () => {
    importBatchFile(db, seed(1).replace('status: bottled', 'status: archived'), opts);
    expect(batch(1)).toMatchObject({ status: 'archived', status_manual: true });
  });

  it('reports invalid frontmatter with the field path', () => {
    expect(() => importBatchFile(db, '---\nbatch: one\nstatus: bottled\nsteps: []\n---\n', opts)).toThrow(ImportError);
    expect(() => importBatchFile(db, '---\nbatch: one\nstatus: bottled\nsteps: []\n---\n', opts)).toThrow(/batch:/);
    expect(() => importBatchFile(db, 'no frontmatter', opts)).toThrow(/frontmatter/);
  });

  it('drops the generated Timeline section from the notes', () => {
    expect(notesFromBody('\n## Notes\nA\n\n## Timeline\n- x\n\n## Tasting\nB\n')).toBe('## Notes\nA\n\n## Tasting\nB');
  });
});
