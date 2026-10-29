import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-support.ts';

let webDir: string;
let t: ReturnType<typeof testApp>;
beforeEach(() => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ferment-web-'));
  fs.mkdirSync(path.join(webDir, 'assets'));
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(webDir, 'sw.js'), 'self');
  t = testApp(undefined, undefined, webDir);
});
afterEach(() => {
  t.cleanup();
  fs.rmSync(webDir, { recursive: true, force: true });
});

describe('web client', () => {
  it('serves hashed assets as immutable and the rest revalidated', async () => {
    const asset = await t.call('GET', '/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const sw = await t.call('GET', '/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('answers client routes with the app shell', async () => {
    for (const url of ['/', '/b/0c2f6a54-55c4-4f6b-9d0e-0d0a7b0e6f11', '/new']) {
      const res = await t.call('GET', url);
      expect(res.status).toBe(200);
      expect(res.body).toContain('<title>app</title>');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('keeps 404s for missing files, API routes and media', async () => {
    expect((await t.call('GET', '/assets/missing.js')).status).toBe(404);
    const api = await t.call('GET', '/api/nope');
    expect(api.status).toBe(404);
    expect(api.body).toEqual({ error: 'Not found' });
    expect((await t.call('GET', '/media/nope.jpg')).status).toBe(404);
  });
});
