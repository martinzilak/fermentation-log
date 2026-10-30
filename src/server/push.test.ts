import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { dumpTables } from './export.ts';
import { dueNudges, nudgeText, runNudges, type NudgeSettings } from './nudges.ts';
import type { Notice, PushResult, PushSender, Subscription } from './push.ts';
import { testApp } from './test-support.ts';

const id = () => randomUUID();
const keys = { p256dh: 'BPublicKey_-', auth: 'authSecret' };

/** A sender that records what it sent and answers per endpoint. */
function fakeSender(answers: Record<string, PushResult> = {}) {
  const sent: { endpoint: string; notice: Notice }[] = [];
  const send: PushSender = async (sub: Subscription, notice: Notice) => {
    const result = answers[sub.endpoint] ?? 'sent';
    if (result === 'sent') sent.push({ endpoint: sub.endpoint, notice });
    return result;
  };
  return { send, sent };
}

let t: ReturnType<typeof testApp>;
afterEach(() => t?.cleanup());

describe('VAPID config', () => {
  it('takes all three keys or none', () => {
    expect(loadConfig({}).vapid).toBeNull();
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'p' })).toThrow(/VAPID/);
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'me' })).toThrow(/mailto/);
    expect(loadConfig({ VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:me@example.com' }).vapid).toEqual({
      publicKey: 'p',
      privateKey: 'k',
      subject: 'mailto:me@example.com',
    });
  });
});

describe('push subscriptions (SPEC §9)', () => {
  it('refuses to subscribe while the server has no keys', async () => {
    t = testApp(undefined, undefined, undefined, null);
    expect((await t.call('GET', '/api/push')).body).toEqual({ public_key: null });
    const res = await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: 'https://web.push.apple.com/a', keys });
    expect(res.status).toBe(503);
  });

  it('subscribes a device once, tests it, and drops it when it is gone', async () => {
    const fake = fakeSender({ 'https://web.push.apple.com/gone': 'gone' });
    t = testApp(undefined, undefined, undefined, fake.send);
    const a = 'https://web.push.apple.com/a';
    expect((await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: a, keys })).status).toBe(201);
    expect((await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: a, keys: { ...keys, auth: 'newSecret' } })).status).toBe(200);
    expect(t.db.prepare('SELECT auth FROM push_subscriptions').pluck().all()).toEqual(['newSecret']);
    expect((await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: 'http://insecure.example/a', keys })).status).toBe(400);

    expect((await t.call('POST', '/api/push/test', { endpoint: a })).body).toEqual({ sent: true });
    expect(fake.sent.map((s) => s.endpoint)).toEqual([a]);

    const gone = 'https://web.push.apple.com/gone';
    await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: gone, keys });
    expect((await t.call('POST', '/api/push/test', { endpoint: gone })).body).toEqual({ sent: false });
    expect(t.db.prepare('SELECT endpoint FROM push_subscriptions').pluck().all()).toEqual([a]);

    expect((await t.call('DELETE', '/api/push/subscribe', { endpoint: a })).status).toBe(204);
    expect(t.db.prepare('SELECT COUNT(*) FROM push_subscriptions').pluck().get()).toBe(0);
  });

  it('leaves subscriptions out of the export', async () => {
    t = testApp(undefined, undefined, undefined, fakeSender().send);
    await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: 'https://web.push.apple.com/a', keys });
    expect(Object.keys(dumpTables(t.db))).not.toContain('push_subscriptions');
  });

  it('keeps the reminder hour out of the quiet hours', async () => {
    t = testApp();
    expect((await t.call('PATCH', '/api/settings', { nudge_hour: 7 })).status).toBe(400);
    expect((await t.call('PATCH', '/api/settings', { nudge_hour: 22 })).status).toBe(400);
    expect((await t.call('PATCH', '/api/settings', { nudge_burp: 1, nudge_hour: 9 })).body).toMatchObject({ nudge_burp: 1, nudge_hour: 9 });
  });
});

describe('nudges (SPEC §9)', () => {
  const settings: NudgeSettings = { hour: 18, day0Photo: true, checks: true, burp: false, readyDays: 14 };

  it('says what is due on a ferment day, leaving out what was logged', () => {
    const none = new Set<string>();
    expect(nudgeText(0, settings, none)).toBe('Take a photo.');
    expect(nudgeText(3, settings, none)).toBeNull();
    expect(nudgeText(7, settings, none)).toBe('Take a photo and measure the pH.');
    expect(nudgeText(7, settings, new Set(['ph']))).toBe('Take a photo.');
    expect(nudgeText(7, settings, new Set(['photo', 'ph']))).toBeNull();
    expect(nudgeText(14, settings, new Set(['photo']))).toBe('Measure the pH. Ready for the next step?');
    expect(nudgeText(3, { ...settings, burp: true }, none)).toBe('Burp the jar.');
    expect(nudgeText(0, { ...settings, burp: true, day0Photo: false }, none)).toBeNull();
    expect(nudgeText(14, { ...settings, checks: false, readyDays: 0 }, none)).toBeNull();
  });

  async function fermentingBatch(date: string) {
    const batchId = id();
    await t.call('POST', '/api/batches', { id: batchId, number: 5, name: 'Sriracha' });
    await t.call('POST', `/api/batches/${batchId}/steps`, { id: id(), type: 'ferment', date });
    return batchId;
  }

  it('sends from the reminder hour, once per day, never in the quiet hours', async () => {
    const fake = fakeSender();
    t = testApp(undefined, undefined, undefined, fake.send);
    t.setNow('2026-10-29T10:00:00.000Z');
    const batchId = await fermentingBatch('2026-10-23');
    const deps = { db: t.db, timeZone: 'Europe/Bratislava', send: fake.send };

    // 30 Oct is day 7. Bratislava is UTC+1.
    expect(await runNudges(deps, new Date('2026-10-30T16:00:00.000Z'))).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) FROM nudges_sent').pluck().get()).toBe(0);
    await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: 'https://web.push.apple.com/a', keys });
    expect(dueNudges(t.db, new Date('2026-10-30T16:59:00.000Z'), deps.timeZone)).toEqual([]);
    expect(dueNudges(t.db, new Date('2026-10-30T21:30:00.000Z'), deps.timeZone)).toEqual([]);

    // A pH logged earlier today is left out.
    const ph = await t.call('POST', `/api/batches/${batchId}/events`, {
      id: id(),
      type: 'ph',
      occurred_at: '2026-10-30T08:00:00.000Z',
      payload: { value: 3.9, method: 'strip' },
    });
    expect(ph.status).toBe(201);
    expect(await runNudges(deps, new Date('2026-10-30T17:05:00.000Z'))).toBe(1);
    expect(fake.sent[0]!.notice).toEqual({ title: '#5 Sriracha · day 7', body: 'Take a photo.', url: `/b/${batchId}`, tag: `batch-${batchId}` });
    expect(await runNudges(deps, new Date('2026-10-30T17:10:00.000Z'))).toBe(0);
    expect(fake.sent).toHaveLength(1);
  });

  it('tries again while no device gets it', async () => {
    const fake = fakeSender({ 'https://web.push.apple.com/a': 'failed' });
    t = testApp(undefined, undefined, undefined, fake.send);
    t.setNow('2026-10-29T10:00:00.000Z');
    await fermentingBatch('2026-10-30');
    await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: 'https://web.push.apple.com/a', keys });
    const deps = { db: t.db, timeZone: 'Europe/Bratislava', send: fake.send };
    expect(await runNudges(deps, new Date('2026-10-30T17:05:00.000Z'))).toBe(0);
    expect(dueNudges(t.db, new Date('2026-10-30T17:10:00.000Z'), deps.timeZone)).toHaveLength(1);
  });
});
