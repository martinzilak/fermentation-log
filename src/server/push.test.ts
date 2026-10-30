import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { dumpTables } from './export.ts';
import { dueNudges, ruleOnDay, runNudges } from './nudges.ts';
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
    expect(res.status).toBe(409);
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

  it('keeps reminder rules out of the quiet hours and own reminders worded', async () => {
    t = testApp();
    const rule = { id: id(), action: 'photo', first_day: 1, every_days: 0, hour: 9 };
    expect((await t.call('PUT', '/api/reminders', [{ ...rule, hour: 7 }])).status).toBe(400);
    expect((await t.call('PUT', '/api/reminders', [{ ...rule, hour: 22 }])).status).toBe(400);
    expect((await t.call('PUT', '/api/reminders', [{ ...rule, action: 'custom' }])).status).toBe(400);
    const saved = await t.call('PUT', '/api/reminders', [rule, { ...rule, id: id(), action: 'custom', text: ' Top up the brine ' }]);
    expect(saved.body).toMatchObject([{ action: 'photo', text: null }, { action: 'custom', text: 'Top up the brine' }]);
  });
});

describe('reminders (SPEC §9, §15.11)', () => {
  it('turns the old schedule into rules', () => {
    t = testApp();
    expect(t.db.prepare('SELECT action, first_day, every_days, hour FROM reminder_rules ORDER BY position').all()).toEqual([
      { action: 'photo', first_day: 1, every_days: 0, hour: 18 },
      { action: 'photo', first_day: 8, every_days: 7, hour: 18 },
      { action: 'ph', first_day: 15, every_days: 3, hour: 18 },
      { action: 'burp', first_day: 2, every_days: 1, hour: 18 },
    ]);
    expect(t.db.prepare("SELECT COUNT(*) FROM settings WHERE key LIKE 'nudge%'").pluck().get()).toBe(0);
  });

  it('falls on its first day and then every few days', () => {
    expect([1, 2, 8].map((d) => ruleOnDay({ first_day: 1, every_days: 0 }, d))).toEqual([true, false, false]);
    expect([7, 8, 14, 15, 22].map((d) => ruleOnDay({ first_day: 8, every_days: 7 }, d))).toEqual([false, true, false, true, true]);
  });

  async function fermentingBatch(date: string, needsBurping = false, number = 5) {
    const batchId = id();
    await t.call('POST', '/api/batches', { id: batchId, number, name: 'Sriracha' });
    await t.call('POST', `/api/batches/${batchId}/steps`, { id: id(), type: 'ferment', date, params: needsBurping ? { needs_burping: true } : {} });
    return batchId;
  }

  const rule = (action: string, first_day: number, every_days: number, hour: number, text?: string) => ({ id: id(), action, first_day, every_days, hour, ...(text ? { text } : {}) });

  it('sends what is due from each rule’s hour, together, once, leaving out what was logged', async () => {
    const fake = fakeSender();
    t = testApp(undefined, undefined, undefined, fake.send);
    t.setNow('2026-10-29T10:00:00.000Z');
    await t.call('PUT', '/api/reminders', [rule('photo', 8, 7, 18), rule('ph', 8, 0, 18), rule('custom', 1, 1, 9, 'Top up the brine.'), rule('burp', 2, 1, 9)]);
    const batchId = await fermentingBatch('2026-10-23');
    const deps = { db: t.db, timeZone: 'Europe/Bratislava', send: fake.send };

    // 30 Oct is Day 8. Bratislava is UTC+1.
    expect(await runNudges(deps, new Date('2026-10-30T09:00:00.000Z'))).toBe(0);
    await t.call('POST', '/api/push/subscribe', { id: id(), endpoint: 'https://web.push.apple.com/a', keys });
    expect(dueNudges(t.db, new Date('2026-10-30T07:30:00.000Z'), deps.timeZone)).toEqual([]);
    // At 10:00 only the 9 o'clock rules; no burp, as this jar doesn't need it.
    expect(await runNudges(deps, new Date('2026-10-30T09:05:00.000Z'))).toBe(1);
    expect(fake.sent[0]!.notice).toEqual({ title: '#5 Sriracha · Day 8', body: 'Top up the brine.', url: `/b/${batchId}`, tag: `batch-${batchId}` });
    expect(await runNudges(deps, new Date('2026-10-30T09:10:00.000Z'))).toBe(0);

    // A pH logged earlier today is left out of the evening one.
    await t.call('POST', `/api/batches/${batchId}/events`, { id: id(), type: 'ph', occurred_at: '2026-10-30T08:00:00.000Z', payload: { value: 3.9, method: 'strip' } });
    expect(await runNudges(deps, new Date('2026-10-30T17:05:00.000Z'))).toBe(1);
    expect(fake.sent[1]!.notice.body).toBe('Take a photo.');
    expect(dueNudges(t.db, new Date('2026-10-30T20:00:00.000Z'), deps.timeZone)).toEqual([]);
    expect(dueNudges(t.db, new Date('2026-10-30T21:30:00.000Z'), deps.timeZone)).toEqual([]);
  });

  it('reminds to burp only the jars that need it', async () => {
    const fake = fakeSender();
    t = testApp(undefined, undefined, undefined, fake.send);
    t.setNow('2026-10-29T10:00:00.000Z');
    await t.call('PUT', '/api/reminders', [rule('burp', 2, 1, 9)]);
    await fermentingBatch('2026-10-28');
    const sealed = await fermentingBatch('2026-10-28', true, 6);
    const due = dueNudges(t.db, new Date('2026-10-30T09:05:00.000Z'), 'Europe/Bratislava');
    expect(due.map((n) => [n.batch_id, n.notice.body])).toEqual([[sealed, 'Burp the jar.']]);
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
