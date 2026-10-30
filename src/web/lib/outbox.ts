// The write outbox (SPEC §8.5). Batch, step, line, event and attachment
// writes, and new lots, are stored first and sent in order. When the server can't be
// reached they stay queued and are retried with backoff; every POST carries a
// client-generated id, so a write replayed after a lost response is not
// duplicated. A caller waits while the write can be sent, and gets QUEUED as
// soon as it can't.
import { HttpError } from './errors.ts';

export type FormEntry = { name: string; value: string } | { name: string; blob: Blob; filename: string };

export interface Op {
  /** Order of the writes; also the storage key. */
  seq: number;
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  json?: unknown;
  form?: FormEntry[];
}

/** What a write resolves to when it was queued instead of sent. */
export const QUEUED = Object.freeze({ queued: true as const });

const OUTBOX_URL = /^\/api\/(batches(\/|$)|steps\/|lines\/|events\/)/;

/**
 * Writes to batches and everything in them, and new lots, which weighing
 * creates on the spot; other reference data is saved directly.
 */
export const usesOutbox = (method: string, url: string) =>
  method !== 'GET' && (OUTBOX_URL.test(url) || (method === 'POST' && url === '/api/lots'));

export interface OpStore {
  load(): Promise<Op[]>;
  put(op: Op): Promise<void>;
  remove(seq: number): Promise<void>;
}

export interface OutboxDeps {
  store: OpStore;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  isReachable: () => boolean;
  setReachable: (reachable: boolean) => void;
  /** Called when the server accepted a write, before it leaves the queue. */
  onSent?: (op: Op) => void;
  /** A queued write the server refused after its caller had moved on. */
  onRefused?: (op: Op, error: HttpError) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

const TIMEOUT_MS = { json: 10_000, form: 60_000 };
const BACKOFF_MS = { first: 1_000, max: 60_000 };

/**
 * Retried rather than dropped: server errors (a gateway error is the container
 * down behind Tailscale Serve), timeouts, rate limits and auth errors, which
 * may pass. Any other 4xx is the server refusing this write.
 */
const retryable = (status: number) => status >= 500 || [401, 403, 408, 429].includes(status);

export function formEntries(form: FormData): FormEntry[] {
  return [...form.entries()].map(([name, value]) =>
    typeof value === 'string' ? { name, value } : { name, blob: value, filename: value.name },
  );
}

function formData(entries: FormEntry[]): FormData {
  const form = new FormData();
  for (const e of entries) {
    if ('value' in e) form.append(e.name, e.value);
    else form.append(e.name, e.blob, e.filename);
  }
  return form;
}

type Waiter = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

export class Outbox {
  private ops: Op[] = [];
  /** A copy of `ops` that changes identity with every change, for React. */
  private snapshot: readonly Op[] = [];
  private waiters = new Map<number, Waiter>();
  private listeners = new Set<() => void>();
  private running = false;
  private failures = 0;
  private timer: unknown;
  private lastSeq = 0;
  private readonly deps: OutboxDeps;

  constructor(deps: OutboxDeps) {
    this.deps = deps;
  }

  /** The writes not yet accepted by the server, oldest first. */
  pending(): readonly Op[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Picks up writes stored by an earlier session and starts sending them. */
  async load(): Promise<void> {
    const stored = await this.deps.store.load();
    const known = new Set(this.ops.map((o) => o.seq));
    this.ops = [...stored.filter((o) => !known.has(o.seq)), ...this.ops].sort((a, b) => a.seq - b.seq);
    this.lastSeq = Math.max(this.lastSeq, ...this.ops.map((o) => o.seq));
    this.notify();
    void this.flush();
  }

  /** Queues a write; resolves to the server's answer, or QUEUED if it can't be sent now. */
  async send(method: Op['method'], url: string, body?: unknown): Promise<unknown> {
    this.lastSeq = Math.max(this.lastSeq + 1, Date.now());
    const op: Op = {
      seq: this.lastSeq,
      method,
      url,
      ...(body instanceof FormData ? { form: formEntries(body) } : body === undefined ? {} : { json: body }),
    };
    this.ops.push(op);
    this.notify();
    await this.deps.store.put(op);
    const result = new Promise((resolve, reject) => this.waiters.set(op.seq, { resolve, reject }));
    // Known to be offline: don't keep the screen waiting on a request that will time out.
    if (!this.deps.isReachable()) this.release(op.seq);
    void this.flush();
    return result;
  }

  /** Tries the queue again now, e.g. when the network or the app comes back. */
  retry(): void {
    this.clearTimer();
    void this.flush();
  }

  private notify() {
    this.snapshot = [...this.ops];
    for (const l of this.listeners) l();
  }

  private release(seq: number) {
    this.waiters.get(seq)?.resolve(QUEUED);
    this.waiters.delete(seq);
  }

  private clearTimer() {
    if (this.timer === undefined) return;
    (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = undefined;
  }

  private attempt(op: Op): Promise<Response> {
    const json = op.json !== undefined;
    return this.deps.fetch(op.url, {
      method: op.method,
      headers: json ? { 'Content-Type': 'application/json' } : {},
      body: op.form ? formData(op.form) : json ? JSON.stringify(op.json) : null,
      signal: AbortSignal.timeout(op.form ? TIMEOUT_MS.form : TIMEOUT_MS.json),
    });
  }

  private async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.ops.length > 0) {
        const op = this.ops[0]!;
        let res: Response;
        try {
          res = await this.attempt(op);
        } catch {
          return this.stall();
        }
        if (retryable(res.status)) return this.stall();
        this.failures = 0;
        this.deps.setReachable(true);
        const data = res.status === 204 ? undefined : ((await res.json().catch(() => null)) as { error?: string } | null);
        if (res.ok) this.deps.onSent?.(op);
        this.ops.shift();
        await this.deps.store.remove(op.seq);
        this.notify();
        const waiter = this.waiters.get(op.seq);
        this.waiters.delete(op.seq);
        if (res.ok) waiter?.resolve(data);
        else {
          const error = new HttpError(res.status, data?.error ?? res.statusText);
          if (waiter) waiter.reject(error);
          else this.deps.onRefused?.(op, error);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private stall() {
    this.deps.setReachable(false);
    for (const seq of [...this.waiters.keys()]) this.release(seq);
    this.clearTimer();
    const delay = Math.min(BACKOFF_MS.max, BACKOFF_MS.first * 2 ** this.failures++);
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }
}
