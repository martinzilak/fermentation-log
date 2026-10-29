import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { nightlyBackup, snapshot } from './backup.ts';
import { migrate, openDb, type DB } from './db.ts';
import { findEntry } from './entries.ts';
import { exportBatch, exportFiles, writeExport, type ExportContext } from './export.ts';
import { importBatchFile, notesFromBody, parseBatchFile } from './import.ts';
import { missedNightly, nextNightly, runNightly } from './nightly.ts';
import { testApp, unzip } from './test-support.ts';

const SEED_DIR = fileURLToPath(new URL('../../seed', import.meta.url));
const seed = (n: number) => fs.readFileSync(path.join(SEED_DIR, `batch-00${n}.md`), 'utf8');
const opts = { author: 'import', now: '2026-10-29T10:00:00.000Z' };
const TZ = 'Europe/Bratislava';
const id = () => randomUUID();

function freshDb(): DB {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

const context = (db: DB, mediaDir = '/nonexistent'): ExportContext => ({ db, mediaDir, timeZone: TZ, now: new Date(opts.now) });

function batchFiles(db: DB): Map<string, string> {
  return new Map(
    exportFiles(context(db)).flatMap((f) => ('text' in f && f.name.endsWith('.md') ? [[f.name, f.text] as const] : [])),
  );
}

describe('seed round trip (SPEC §10.3)', () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    for (const n of [1, 2, 3, 4]) importBatchFile(db, seed(n), opts);
  });
  afterEach(() => db.close());

  it('exports the seed frontmatter, with names through the aliases and lot seasons filled in', () => {
    const files = batchFiles(db);
    for (const n of [1, 2, 3, 4]) {
      const expected = parseYaml(/^---\n([\s\S]*?)\n---/.exec(seed(n))![1]!);
      for (const step of expected.steps) {
        for (const add of step.add ?? []) {
          add.name = findEntry(db, add.kind === 'pepper' ? 'varieties' : 'catalog_items', add.name)!.name;
          if (add.lot && add.lot.season === undefined) add.lot.season = Number(step.date.slice(0, 4));
        }
      }
      const exported = parseBatchFile(files.get(`batch-00${n}.md`)!);
      expect(exported.frontmatter).toEqual(parseBatchFile(`---\n${JSON.stringify(expected)}\n---\n`).frontmatter);
      expect(notesFromBody(exported.body)).toBe(notesFromBody(parseBatchFile(seed(n)).body));
    }
  });

  it('reaches a fixed point: importing an export and exporting again changes nothing', () => {
    const first = batchFiles(db);
    const again = freshDb();
    for (const text of first.values()) importBatchFile(again, text, opts);
    expect(batchFiles(again)).toEqual(first);
    again.close();
  });
});

describe('export API', () => {
  let t: ReturnType<typeof testApp>;
  beforeEach(() => {
    t = testApp();
  });
  afterEach(() => t.cleanup());

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  async function post(url: string, body: Record<string, unknown>) {
    const res = await t.call('POST', url, { id: id(), ...body });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** A bottled batch with a photo, a two-line note, a one-off fill and a step note. */
  async function fullBatch() {
    const batch = await post('/api/batches', { color: 'green', notes_md: '## Notes\nGreen one.\n\n## Tasting\nBright.' });
    const ferment = await post(`/api/batches/${batch.id}/steps`, { type: 'ferment', date: '2026-10-01', params: { vessel_tare_g: 1650 } });
    await post(`/api/steps/${ferment.id}/lines`, { name: 'Jalapeño Green', kind: 'pepper', grams: 500 });
    await post(`/api/steps/${ferment.id}/lines`, { name: 'Salt', kind: 'salt', grams: 15, note: 'sea salt' });
    const cook = await post(`/api/batches/${batch.id}/steps`, { type: 'cook', date: '2026-10-20', params: { minutes: 10 }, note: 'Low simmer' });
    await post(`/api/steps/${cook.id}/lines`, { name: 'Spirit vinegar 8 %', kind: 'acid', grams: 50 });
    await post(`/api/batches/${batch.id}/events`, { type: 'note', occurred_at: '2026-10-02T08:00:00.000Z', text: 'Bubbling.\n## not a heading' });
    const photo = await post(`/api/batches/${batch.id}/events`, { type: 'photo', occurred_at: '2026-10-03T08:00:00.000Z' });
    const form = new FormData();
    const attId = id();
    form.set('id', attId);
    form.set('file', new File([jpeg], 'upload', { type: 'image/jpeg' }));
    expect((await t.app.request(`/api/events/${photo.id}/attachments`, { method: 'POST', body: form })).status).toBe(201);
    const jar = await post('/api/bottle-types', { name: 'Woozy', volume_ml: 150 });
    await post(`/api/batches/${batch.id}/events`, {
      type: 'bottled',
      occurred_at: '2026-10-21T16:00:00.000Z',
      payload: {
        fills: [
          { bottle_type_id: jar.id, count: 4 },
          { volume_ml: 330, count: 1, label: 'Old jam jar' },
        ],
        ph: null,
        ph_not_measured_reason: 'Meter broken',
        leftover_g: 40,
      },
    });
    return { batch, file: `${attId}.jpg` };
  }

  it('exports one batch as Markdown with its timeline and media paths', async () => {
    const { batch, file } = await fullBatch();
    const res = await t.call('GET', `/api/batches/${batch.id}/export.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="batch-001.md"');
    const { frontmatter: fm, body } = parseBatchFile(res.body);
    expect(fm.steps[1]).toMatchObject({ type: 'cook', params: { minutes: 10 }, note: 'Low simmer' });
    expect(fm.output).toEqual({
      ph: null,
      ph_not_measured_reason: 'Meter broken',
      fills: [
        { bottle: 'Woozy', ml: 150, count: 4 },
        { label: 'Old jam jar', ml: 330, count: 1 },
      ],
      leftover_g: 40,
    });
    expect(body).toContain('## Notes\nGreen one.\n\n## Timeline\n- 2026-10-02 10:00 · Note: Bubbling.\n  ## not a heading\n');
    expect(body).toContain(`- 2026-10-03 10:00 · Photo\n  ![photo](media/${file})`);
    expect(body).toContain('· Bottled: 4 × 150 ml Woozy, 1 × 330 ml Old jam jar; pH not measured: Meter broken; 40 g left over\n\n## Tasting\nBright.');
    expect(notesFromBody(body)).toBe('## Notes\nGreen one.\n\n## Tasting\nBright.');
  });

  it('re-imports an exported batch without losing its frontmatter', async () => {
    const { batch } = await fullBatch();
    const text = (await t.call('GET', `/api/batches/${batch.id}/export.md`)).body;
    const db = freshDb();
    const imported = importBatchFile(db, text, opts);
    expect(parseBatchFile(exportBatch(context(db), imported.id)!.text).frontmatter).toEqual(parseBatchFile(text).frontmatter);
    db.close();
  });

  it('zips every batch, all.json and the media, leaving deleted batches out', async () => {
    const { file } = await fullBatch();
    const gone = await post('/api/batches', {});
    await post(`/api/batches/${gone.id}/steps`, { type: 'ferment' });
    expect((await t.call('DELETE', `/api/batches/${gone.id}`)).status).toBe(204);
    expect((await t.call('GET', `/api/batches/${gone.id}/export.md`)).status).toBe(404);

    const res = await t.app.request('/api/export.zip');
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ferment-export-20261029.zip"');
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    expect([...files.keys()]).toEqual(['batch-001.md', 'all.json', `media/${file}`]);
    expect(files.get(`media/${file}`)!.equals(Buffer.from(jpeg))).toBe(true);
    const all = JSON.parse(files.get('all.json')!.toString());
    expect(all.exported_at).toBe('2026-10-29T10:00:00.000Z');
    expect(all.tables.batches.map((b: { number: number }) => b.number)).toEqual([1]);
    expect(all.tables.steps).toHaveLength(2);
    expect(all.tables.attachments).toHaveLength(1);
    expect(all.tables.schema_migrations.length).toBeGreaterThan(0);
  });

  it('reports no nightly run before the first', async () => {
    const res = await t.call('GET', '/api/export/status');
    expect(res.body).toEqual({ last_export_at: null, last_backup_on: null });
  });
});

describe('nightly export and backups (SPEC §10.2)', () => {
  let dir: string;
  let db: DB;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferment-nightly-'));
    db = freshDb();
    importBatchFile(db, seed(4), opts);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs at the next 03:00 in the time zone, across DST changes', () => {
    const next = (iso: string) => nextNightly(new Date(iso), TZ).toISOString();
    expect(next('2026-10-29T10:00:00Z')).toBe('2026-10-30T02:00:00.000Z');
    expect(next('2026-10-29T01:30:00Z')).toBe('2026-10-29T02:00:00.000Z');
    expect(next('2026-10-29T02:00:00Z')).toBe('2026-10-30T02:00:00.000Z');
    expect(next('2026-03-28T12:00:00Z')).toBe('2026-03-29T01:00:00.000Z');
    expect(next('2026-10-24T12:00:00Z')).toBe('2026-10-25T02:00:00.000Z');
  });

  it('notices a night missed while the server was down', () => {
    const backups = path.join(dir, 'backups');
    expect(missedNightly(new Date('2026-10-29T10:00:00Z'), TZ, backups)).toBe(true);
    nightlyBackup(db, backups, '2026-10-29', 14);
    expect(missedNightly(new Date('2026-10-29T10:00:00Z'), TZ, backups)).toBe(false);
    expect(missedNightly(new Date('2026-10-30T01:00:00Z'), TZ, backups)).toBe(false);
    expect(missedNightly(new Date('2026-10-30T03:00:00Z'), TZ, backups)).toBe(true);
  });

  it('keeps the last 14 nightly backups and leaves the other snapshots alone', () => {
    const backups = path.join(dir, 'backups');
    snapshot(db, backups, 'ferment-startup', 10, new Date(opts.now));
    for (let day = 1; day <= 16; day++) nightlyBackup(db, backups, `2026-10-${String(day).padStart(2, '0')}`, 14);
    const files = fs.readdirSync(backups).sort();
    expect(files).toHaveLength(15);
    expect(files[0]).toBe('ferment-20261003.db');
    expect(files.at(-2)).toBe('ferment-20261016.db');
    expect(files.at(-1)).toMatch(/^ferment-startup-/);
  });

  it('writes the export and a backup, replacing the previous export whole', () => {
    const mediaDir = path.join(dir, 'media');
    fs.mkdirSync(mediaDir);
    fs.mkdirSync(path.join(dir, 'exports'));
    fs.writeFileSync(path.join(dir, 'exports', 'batch-099.md'), 'old');

    runNightly({ db, dataDir: dir, mediaDir, timeZone: TZ }, new Date(opts.now));
    expect(fs.readdirSync(path.join(dir, 'exports')).sort()).toEqual(['all.json', 'batch-004.md', 'media']);
    expect(fs.readdirSync(path.join(dir, 'backups'))).toEqual(['ferment-20261029.db']);
    expect(fs.existsSync(path.join(dir, 'exports.next')) || fs.existsSync(path.join(dir, 'exports.old'))).toBe(false);
  });

  it('hard-links media into the export', () => {
    const mediaDir = path.join(dir, 'media');
    fs.mkdirSync(mediaDir);
    const eventId = id();
    const file = `${id()}.jpg`;
    const batchId = db.prepare('SELECT id FROM batches').pluck().get() as string;
    db.prepare(
      "INSERT INTO events (id, batch_id, type, occurred_at, created_at, updated_at, author) VALUES (?, ?, 'photo', ?, ?, ?, 'import')",
    ).run(eventId, batchId, opts.now, opts.now, opts.now);
    db.prepare("INSERT INTO attachments (id, event_id, type, file, created_at, author) VALUES (?, ?, 'photo', ?, ?, 'import')").run(
      id(),
      eventId,
      file,
      opts.now,
    );
    fs.writeFileSync(path.join(mediaDir, file), 'jpeg');

    writeExport({ db, mediaDir, timeZone: TZ, now: new Date(opts.now) }, path.join(dir, 'exports'));
    expect(fs.statSync(path.join(dir, 'exports', 'media', file)).ino).toBe(fs.statSync(path.join(mediaDir, file)).ino);
  });
});
