// Builds an app on an in-memory database for API tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate, openDb } from './db.ts';
import type { PeerResolver } from './auth.ts';

export function testApp(env: NodeJS.ProcessEnv = { DEV_USER: 'cook@example.com' }, getPeer?: PeerResolver) {
  const db = openDb(':memory:');
  migrate(db);
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferment-media-'));
  let now = new Date('2026-10-29T10:00:00.000Z');
  const app = createApp({ config: loadConfig(env), db, mediaDir, now: () => now, ...(getPeer ? { getPeer } : {}) });

  async function call(method: string, url: string, body?: unknown) {
    const res = await app.request(url, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const type = res.headers.get('content-type') ?? '';
    const data: any = res.status === 204 ? null : type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, body: data, headers: res.headers };
  }

  return {
    app,
    db,
    mediaDir,
    call,
    setNow: (iso: string) => {
      now = new Date(iso);
    },
    cleanup: () => {
      db.close();
      fs.rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}
