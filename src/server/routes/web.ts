// Serves the built PWA (dist/web) with an SPA fallback, so client routes like
// /b/<id> load the app shell. Hashed assets are immutable; everything else is
// revalidated so a deploy reaches the phone on the next load.
import fs from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { AppEnv } from '../auth.ts';

const IMMUTABLE = 'private, max-age=31536000, immutable';

export function webRoutes(webDir: string) {
  const r = new Hono<AppEnv>();

  const files = serveStatic({ root: webDir });
  r.use('*', async (c, next) => {
    // A file it found comes back as a Response; otherwise it has called next().
    const res = await files(c, next);
    if (!(res instanceof Response)) return;
    res.headers.set('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
    return res;
  });

  // Client routes have no file extension; a missing asset stays a 404.
  r.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/media/') || path.extname(c.req.path)) return next();
    const html = await fs.readFile(path.join(webDir, 'index.html'), 'utf8');
    c.header('Cache-Control', 'no-cache');
    return c.html(html);
  });

  return r;
}
