// Builds an app on an in-memory database for API tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate, openDb } from './db.ts';
import type { PeerResolver } from './auth.ts';

export function testApp(
  env: NodeJS.ProcessEnv = { DEV_USER: 'cook@example.com' },
  getPeer?: PeerResolver,
  webDir?: string,
) {
  const db = openDb(':memory:');
  migrate(db);
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferment-media-'));
  let now = new Date('2026-10-29T10:00:00.000Z');
  const app = createApp({
    config: loadConfig(env),
    db,
    mediaDir,
    now: () => now,
    ...(getPeer ? { getPeer } : {}),
    ...(webDir ? { webDir } : {}),
  });

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

/** Reads an archive back through its central directory, as unzip does. */
export function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50) throw new Error('No end of central directory');
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) throw new Error('Bad central directory entry');
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const body = archive.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    files.set(name, data);
    at += 46 + nameLength;
  }
  return files;
}
