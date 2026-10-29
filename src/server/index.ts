import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { snapshot } from './backup.ts';
import { loadConfig } from './config.ts';
import { migrate, openDb } from './db.ts';
import { startNightly } from './nightly.ts';

const STARTUP_BACKUPS_KEPT = 10;

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error(`Refusing to start: ${(err as Error).message}`);
  process.exit(1);
}
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });

const dbFile = path.join(config.dataDir, 'ferment.db');
const existed = fs.existsSync(dbFile);
const db = openDb(dbFile);

// Every deploy restarts the container, so a snapshot here precedes every
// migration that deploy might bring.
if (existed) {
  const file = snapshot(db, path.join(config.dataDir, 'backups'), 'ferment-startup', STARTUP_BACKUPS_KEPT);
  console.log(`Startup backup: ${path.basename(file)}`);
}
const applied = migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

if (config.devUser) console.warn(`DEV MODE: every request acts as ${config.devUser}`);

// dist/web relative to the package root, from both src/server and dist/server.
const webDir = fileURLToPath(new URL('../../dist/web', import.meta.url));
const app = createApp({
  config,
  db,
  mediaDir: path.join(config.dataDir, 'media'),
  ...(fs.existsSync(path.join(webDir, 'index.html')) ? { webDir } : {}),
});
let stopNightly = () => {};
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.bindHost }, (info) => {
  console.log(`Listening on ${info.address}:${info.port}`);
  stopNightly = startNightly({ db, dataDir: config.dataDir, mediaDir: path.join(config.dataDir, 'media'), timeZone: config.timeZone });
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopNightly();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
