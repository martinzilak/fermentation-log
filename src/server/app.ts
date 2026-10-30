import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { tailscaleAuth, type AppEnv, type PeerResolver } from './auth.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { ApiError, type AppContext } from './http.ts';
import { batchRoutes } from './routes/batches.ts';
import { exportRoutes } from './routes/export.ts';
import { webPushSender, type PushSender } from './push.ts';
import { mediaRoutes } from './routes/media.ts';
import { pushRoutes } from './routes/push.ts';
import { recipeRoutes } from './routes/recipes.ts';
import { referenceRoutes } from './routes/reference.ts';
import { webRoutes } from './routes/web.ts';

const defaultPeer: PeerResolver = (c) => getConnInfo(c).remote.address;

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
  /** The built PWA; without it (API-only dev) `/` explains how to run the client. */
  webDir?: string;
  getPeer?: PeerResolver;
  now?: () => Date;
  /** Sends Web Push; by default through the push services, when the VAPID keys are set. */
  push?: PushSender | null;
}

export function createApp({ config, db, mediaDir, webDir, getPeer = defaultPeer, now = () => new Date(), push }: AppDeps) {
  const ctx: AppContext = { config, db, mediaDir, now, push: push === undefined ? (config.vapid ? webPushSender(config.vapid) : null) : push };
  const app = new Hono<AppEnv>();

  app.get('/healthz', (c) => c.text('ok'));

  app.use('*', tailscaleAuth(config, getPeer));

  app.get('/api/me', (c) => c.json(c.get('user')));
  app.route('/api', batchRoutes(ctx));
  app.route('/api', referenceRoutes(ctx));
  app.route('/api', exportRoutes(ctx));
  app.route('/api', recipeRoutes(ctx));
  app.route('/api', pushRoutes(ctx));
  app.route('/', mediaRoutes(ctx));

  if (webDir) app.route('/', webRoutes(webDir));
  else app.get('/', (c) => c.text('The web client is not built here. Run `npm run dev:web` and open its URL.'));

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
