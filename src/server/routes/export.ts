// Export downloads (SPEC §10.2, §11): the whole export as a zip, one batch as
// Markdown, and when the nightly job last ran.
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { localDate } from '../../shared/calc.ts';
import type { AppEnv } from '../auth.ts';
import { lastNightlyBackup } from '../backup.ts';
import { exportBatch, exportFiles, type ExportContext } from '../export.ts';
import { ApiError, type AppContext } from '../http.ts';
import { zip } from '../zip.ts';

const attachment = (name: string) => `attachment; filename="${name}"`;

/** Pulls the archive one chunk at a time, so it never sits whole in memory. */
function stream(chunks: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

export function exportRoutes(ctx: AppContext) {
  const r = new Hono<AppEnv>();
  const exportContext = (): ExportContext => ({ db: ctx.db, mediaDir: ctx.mediaDir, timeZone: ctx.config.timeZone, now: ctx.now() });

  r.get('/export.zip', () => {
    const ec = exportContext();
    const entries = exportFiles(ec).map((f) =>
      'text' in f
        ? { name: f.name, data: () => Buffer.from(f.text) }
        : { name: f.name, data: () => fs.promises.readFile(f.source), store: true },
    );
    const name = `ferment-export-${localDate(ec.now.toISOString(), ec.timeZone).replaceAll('-', '')}.zip`;
    return new Response(stream(zip(entries, ec.now)), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(name), 'Cache-Control': 'no-store' },
    });
  });

  r.get('/batches/:id/export.md', (c) => {
    const file = exportBatch(exportContext(), c.req.param('id'));
    if (!file) throw new ApiError(404, 'Batch not found');
    return c.body(file.text, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': attachment(file.name),
      'Cache-Control': 'no-store',
    });
  });

  r.get('/export/status', (c) => {
    const exported = path.join(ctx.config.dataDir, 'exports', 'all.json');
    return c.json({
      last_export_at: fs.existsSync(exported) ? fs.statSync(exported).mtime.toISOString() : null,
      last_backup_on: lastNightlyBackup(path.join(ctx.config.dataDir, 'backups')),
    });
  });

  return r;
}
