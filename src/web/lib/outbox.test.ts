import { describe, expect, it } from 'vitest';
import { HttpError } from './errors.ts';
import { Outbox, QUEUED, usesOutbox, type Op, type OpStore } from './outbox.ts';

class MemoryStore implements OpStore {
  ops = new Map<number, Op>();
  async load() {
    return [...this.ops.values()];
  }
  async put(op: Op) {
    this.ops.set(op.seq, structuredClone(op));
  }
  async remove(seq: number) {
    this.ops.delete(seq);
  }
}

/** A fake server: `up` decides whether requests get through; `answer` picks the response. */
function setup(opts: { up?: boolean; answer?: (url: string, init: RequestInit) => Response; store?: MemoryStore } = {}) {
  const state = { up: opts.up ?? true, hang: false, reachable: true };
  const received: { method: string; url: string; body: unknown }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const refused: [Op, HttpError][] = [];
  const sent: Op[] = [];
  const store = opts.store ?? new MemoryStore();
  const outbox = new Outbox({
    store,
    fetch: async (url, init) => {
      if (state.hang) return new Promise<Response>(() => {});
      if (!state.up) throw new TypeError('Failed to fetch');
      received.push({ method: init.method!, url, body: init.body });
      return opts.answer?.(url, init) ?? Response.json({ ok: url }, { status: 201 });
    },
    isReachable: () => state.reachable,
    setReachable: (r) => {
      state.reachable = r;
    },
    onSent: (op) => sent.push(op),
    onRefused: (op, error) => refused.push([op, error]),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => {},
  });
  /** Fires the latest retry timer and lets the flush finish. */
  const tick = async () => {
    timers.pop()?.fn();
    await settle();
  };
  return { outbox, state, received, timers, refused, sent, store, tick };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('outbox (SPEC §8.5)', () => {
  it('routes batch writes through the outbox and reference writes past it', () => {
    expect(usesOutbox('POST', '/api/batches')).toBe(true);
    expect(usesOutbox('POST', '/api/batches/x/events')).toBe(true);
    expect(usesOutbox('PATCH', '/api/steps/x')).toBe(true);
    expect(usesOutbox('DELETE', '/api/lines/x')).toBe(true);
    expect(usesOutbox('POST', '/api/events/x/attachments')).toBe(true);
    expect(usesOutbox('GET', '/api/batches')).toBe(false);
    expect(usesOutbox('POST', '/api/lots')).toBe(true);
    expect(usesOutbox('PATCH', '/api/lots/x')).toBe(false);
    expect(usesOutbox('POST', '/api/catalog')).toBe(false);
    expect(usesOutbox('PATCH', '/api/settings')).toBe(false);
  });

  it('sends a write at once when the server is up and resolves to its answer', async () => {
    const t = setup();
    expect(await t.outbox.send('POST', '/api/batches/b/events', { id: 'e1' })).toEqual({ ok: '/api/batches/b/events' });
    expect(t.received).toEqual([{ method: 'POST', url: '/api/batches/b/events', body: '{"id":"e1"}' }]);
    expect(t.outbox.pending()).toEqual([]);
    expect(t.store.ops.size).toBe(0);
    expect(t.sent.map((o) => o.url)).toEqual(['/api/batches/b/events']);
  });

  it('queues writes while the server is down and replays them in order when it is back', async () => {
    const t = setup({ up: false });
    expect(await t.outbox.send('POST', '/api/steps/s/lines', { id: 'l1' })).toBe(QUEUED);
    expect(t.state.reachable).toBe(false);
    expect(await t.outbox.send('POST', '/api/steps/s/lines', { id: 'l2' })).toBe(QUEUED);
    expect(await t.outbox.send('DELETE', '/api/lines/l1')).toBe(QUEUED);
    expect(t.outbox.pending().map((o) => o.url)).toEqual(['/api/steps/s/lines', '/api/steps/s/lines', '/api/lines/l1']);
    expect(t.store.ops.size).toBe(3);

    await t.tick();
    expect(t.received).toEqual([]);
    t.state.up = true;
    await t.tick();
    expect(t.received.map((r) => `${r.method} ${r.url} ${r.body ?? ''}`)).toEqual([
      'POST /api/steps/s/lines {"id":"l1"}',
      'POST /api/steps/s/lines {"id":"l2"}',
      'DELETE /api/lines/l1 ',
    ]);
    expect(t.outbox.pending()).toEqual([]);
    expect(t.store.ops.size).toBe(0);
    expect(t.state.reachable).toBe(true);
  });

  it('doesn’t keep the screen waiting when the server is known to be out of reach', async () => {
    const t = setup();
    t.state.reachable = false;
    t.state.hang = true;
    expect(await t.outbox.send('POST', '/api/batches/b/events', { id: 'e1' })).toBe(QUEUED);
  });

  it('backs off between retries, up to a minute', async () => {
    const t = setup({ up: false });
    await t.outbox.send('POST', '/api/batches', { id: 'b' });
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      delays.push(t.timers.at(-1)!.ms);
      await t.tick();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  it.each([502, 500, 401])('keeps writes the server answers with %i, and retries them', async (first) => {
    let status = first;
    const t = setup({ answer: () => new Response('Bad gateway', { status }) });
    expect(await t.outbox.send('POST', '/api/batches', { id: 'b' })).toBe(QUEUED);
    expect(t.outbox.pending()).toHaveLength(1);
    status = 201;
    await t.tick();
    expect(t.outbox.pending()).toHaveLength(0);
  });

  it('hands a refusal to the waiting caller, and reports one nobody waits for', async () => {
    const answer = (url: string) => (url.includes('bad') ? Response.json({ error: 'Batch not found' }, { status: 404 }) : Response.json({}));
    const waiting = setup({ answer });
    await expect(waiting.outbox.send('POST', '/api/batches/bad/events', { id: 'e' })).rejects.toThrow(HttpError);
    expect(waiting.outbox.pending()).toEqual([]);

    const later = setup({ up: false, answer });
    expect(await later.outbox.send('POST', '/api/batches/bad/events', { id: 'e1' })).toBe(QUEUED);
    expect(await later.outbox.send('POST', '/api/batches/good/events', { id: 'e2' })).toBe(QUEUED);
    later.state.up = true;
    await later.tick();
    expect(later.refused.map(([op, e]) => [op.url, e.status, e.message])).toEqual([['/api/batches/bad/events', 404, 'Batch not found']]);
    expect(later.received.map((r) => r.url)).toEqual(['/api/batches/bad/events', '/api/batches/good/events']);
  });

  it('picks up the writes of an earlier session, keeping their order', async () => {
    const store = new MemoryStore();
    const first = setup({ up: false, store });
    await first.outbox.send('POST', '/api/batches', { id: 'b' });
    await first.outbox.send('POST', '/api/batches/b/steps', { id: 's' });

    const second = setup({ store });
    await second.outbox.load();
    await settle();
    expect(second.received.map((r) => r.url)).toEqual(['/api/batches', '/api/batches/b/steps']);
    await second.outbox.send('POST', '/api/steps/s/lines', { id: 'l' });
    expect(second.received.map((r) => r.url)).toEqual(['/api/batches', '/api/batches/b/steps', '/api/steps/s/lines']);
  });

  it('stores an upload with its file and sends it as multipart form data', async () => {
    const store = new MemoryStore();
    const first = setup({ up: false, store });
    const form = new FormData();
    form.set('id', 'a1');
    form.set('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'photo.jpg');
    expect(await first.outbox.send('POST', '/api/events/e/attachments', form)).toBe(QUEUED);

    const second = setup({ store });
    await second.outbox.load();
    await settle();
    const body = second.received[0]!.body as FormData;
    expect(body.get('id')).toBe('a1');
    const file = body.get('file') as File;
    expect(file.name).toBe('photo.jpg');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0xff, 0xd8, 0xff]);
  });
});
