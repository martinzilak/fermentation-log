import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sniff } from './routes/media.ts';
import { testApp } from './test-support.ts';

let t: ReturnType<typeof testApp>;
beforeEach(() => {
  t = testApp();
});
afterEach(() => t.cleanup());

const id = () => randomUUID();

async function newBatch(extra: Record<string, unknown> = {}) {
  const res = await t.call('POST', '/api/batches', { id: id(), ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

async function addStep(batchId: string, body: Record<string, unknown>) {
  const res = await t.call('POST', `/api/batches/${batchId}/steps`, { id: id(), ...body });
  expect(res.status).toBe(201);
  return res.body;
}

describe('attachments and media', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  async function upload(eventId: string, fields: Record<string, string>, file: Uint8Array<ArrayBuffer>, type = 'image/jpeg') {
    const form = new FormData();
    for (const [k, value] of Object.entries(fields)) form.set(k, value);
    form.set('file', new File([file], 'upload', { type }));
    const res = await t.app.request(`/api/events/${eventId}/attachments`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  }

  it('stores an upload, is idempotent, and serves it with immutable caching', async () => {
    const batch = await newBatch();
    const event = (await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'photo' })).body;
    const attId = id();
    const first = await upload(event.id, { id: attId, width: '2048', height: '1536' }, jpeg);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ type: 'photo', file: `${attId}.jpg`, width: 2048, height: 1536 });
    expect((await upload(event.id, { id: attId }, jpeg)).status).toBe(200);
    expect(fs.readFileSync(path.join(t.mediaDir, `${attId}.jpg`))).toEqual(Buffer.from(jpeg));

    const media = await t.app.request(`/media/${attId}.jpg`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/jpeg');
    expect(media.headers.get('cache-control')).toContain('immutable');
  });

  it('refuses files that are not photos or audio, whatever the declared type', async () => {
    const batch = await newBatch();
    const event = (await t.call('POST', `/api/batches/${batch.id}/events`, { id: id(), type: 'photo' })).body;
    const res = await upload(event.id, { id: id() }, new TextEncoder().encode('hello'), 'image/jpeg');
    expect(res.status).toBe(415);
  });

  it('never serves paths outside the media folder', async () => {
    expect((await t.app.request('/media/..%2Fferment.db')).status).toBe(404);
    expect((await t.app.request('/media/ferment.db')).status).toBe(404);
  });

  it('recognises the formats the client sends', () => {
    const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode(`ftyp${brand}`)]);
    expect(sniff(jpeg)).toEqual({ type: 'photo', ext: 'jpg' });
    expect(sniff(ftyp('M4A '))).toEqual({ type: 'audio', ext: 'm4a' });
    expect(sniff(ftyp('heic'))).toBeNull();
  });
});
