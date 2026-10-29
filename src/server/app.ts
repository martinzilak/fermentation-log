import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { tailscaleAuth, type AppEnv, type PeerResolver } from './auth.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { ApiError, type AppContext } from './http.ts';
import { batchRoutes } from './routes/batches.ts';
import { mediaRoutes } from './routes/media.ts';
import { referenceRoutes } from './routes/reference.ts';

const defaultPeer: PeerResolver = (c) => getConnInfo(c).remote.address;

const helloPage = (login: string, name: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fermentation Log</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 20px/1.5 system-ui, sans-serif; margin: 0; padding: max(24px, env(safe-area-inset-top)) 16px 24px; }
  code { font-size: 18px; }
</style>
</head>
<body>
<h1>Fermentation Log</h1>
<p>Deployment check: signed in as <strong>${escapeHtml(name)}</strong> (<code>${escapeHtml(login)}</code>).</p>
</body>
</html>`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// SQLite constraint failures are client errors: a duplicate batch number, an
// unknown referenced id, or a value a CHECK constraint refuses.
function constraintError(err: InstanceType<typeof Database.SqliteError>): ApiError | null {
  switch (err.code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY':
      return new ApiError(409, 'Conflicts with an existing record', [{ path: '', message: err.message }]);
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
      return new ApiError(400, 'Refers to a record that does not exist');
    case 'SQLITE_CONSTRAINT_CHECK':
    case 'SQLITE_CONSTRAINT_NOTNULL':
      return new ApiError(400, 'Value not allowed', [{ path: '', message: err.message }]);
    default:
      return null;
  }
}

export interface AppDeps {
  config: Config;
  db: DB;
  mediaDir: string;
  getPeer?: PeerResolver;
  now?: () => Date;
}

export function createApp({ config, db, mediaDir, getPeer = defaultPeer, now = () => new Date() }: AppDeps) {
  const ctx: AppContext = { config, db, mediaDir, now };
  const app = new Hono<AppEnv>();

  app.get('/healthz', (c) => c.text('ok'));

  app.use('*', tailscaleAuth(config, getPeer));

  app.get('/api/me', (c) => c.json(c.get('user')));
  app.route('/api', batchRoutes(ctx));
  app.route('/api', referenceRoutes(ctx));
  app.route('/', mediaRoutes(ctx));

  app.get('/', (c) => {
    const { login, name } = c.get('user');
    return c.html(helloPage(login, name));
  });

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));

  app.onError((err, c) => {
    const apiError =
      err instanceof ApiError ? err : err instanceof Database.SqliteError ? constraintError(err) : null;
    if (apiError) {
      return c.json({ error: apiError.message, ...(apiError.issues ? { issues: apiError.issues } : {}) }, apiError.status);
    }
    console.error(`${c.req.method} ${c.req.path} failed:`, err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
