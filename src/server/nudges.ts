// Reminders (SPEC §9, §15.11): a list of rules, each an action on a ferment
// day (the start date is Day 1), repeating every few days or not, from an
// hour of the day. They are for fermenting batches; burping only for batches
// whose container needs it. Rules due for a batch at the same time share one
// notification, and a rule whose action was already logged that day is left
// out. A rule that couldn't go out (no device, server down) is tried again
// until the quiet hours (22:00–08:00), then let go for the day.
import type { ReminderAction, ReminderRule } from '../shared/schemas.ts';
import { daysBetween, localDate } from '../shared/calc.ts';
import type { DB } from './db.ts';
import { wallClock } from './nightly.ts';
import { pushTo, type Notice, type PushSender } from './push.ts';

export const QUIET_FROM = 22;
export const QUIET_UNTIL = 8;
const EVERY_MS = 5 * 60_000;

/** The event that counts as having done an action today. */
const LOGGED_AS: Partial<Record<ReminderAction, string>> = { photo: 'photo', burp: 'burp', ph: 'ph' };

const TEXT: Record<Exclude<ReminderAction, 'custom'>, string> = {
  photo: 'Take a photo.',
  burp: 'Burp the jar.',
  ph: 'Check the pH: ready to end the ferment?',
};

export function reminderRules(db: DB): ReminderRule[] {
  return db.prepare('SELECT id, action, text, first_day, every_days, hour FROM reminder_rules ORDER BY position').all() as ReminderRule[];
}

/** Whether a rule falls on a ferment day (Day 1 is the start date). */
export function ruleOnDay(rule: Pick<ReminderRule, 'first_day' | 'every_days'>, day: number): boolean {
  if (day < rule.first_day) return false;
  return rule.every_days === 0 ? day === rule.first_day : (day - rule.first_day) % rule.every_days === 0;
}

export const ruleText = (rule: Pick<ReminderRule, 'action' | 'text'>) => (rule.action === 'custom' ? (rule.text ?? '') : TEXT[rule.action]);

export interface Nudge {
  batch_id: string;
  day: number;
  rule_ids: string[];
  notice: Notice;
}

/** The reminders due now that haven't been sent, one per batch. */
export function dueNudges(db: DB, now: Date, timeZone: string): Nudge[] {
  const { hour } = wallClock(now.getTime(), timeZone);
  if (hour >= QUIET_FROM || hour < QUIET_UNTIL) return [];
  const rules = reminderRules(db).filter((r) => r.hour <= hour);
  if (rules.length === 0) return [];
  const today = localDate(now.toISOString(), timeZone);
  const batches = db
    .prepare(
      `SELECT b.id, b.number, b.name, f.date AS ferment_date, json_extract(f.params, '$.needs_burping') AS burp
         FROM batches b
         JOIN steps f ON f.id = (SELECT s.id FROM steps s WHERE s.batch_id = b.id AND s.type = 'ferment' ORDER BY s.position LIMIT 1)
        WHERE b.deleted_at IS NULL AND b.status = 'fermenting' AND f.date IS NOT NULL
        ORDER BY b.number`,
    )
    .all() as { id: string; number: number; name: string | null; ferment_date: string; burp: number | null }[];
  const sent = db.prepare('SELECT 1 FROM reminders_sent WHERE batch_id = ? AND rule_id = ? AND day = ?');
  // Two days back covers today in any zone.
  const events = db.prepare('SELECT type, occurred_at FROM events WHERE batch_id = ? AND occurred_at >= ?');
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  const due: Nudge[] = [];
  for (const b of batches) {
    const day = daysBetween(b.ferment_date, today) + 1;
    const logged = new Set(
      (events.all(b.id, since) as { type: string; occurred_at: string }[])
        .filter((e) => localDate(e.occurred_at, timeZone) === today)
        .map((e) => e.type),
    );
    const mine = rules.filter(
      (r) =>
        ruleOnDay(r, day) &&
        (r.action !== 'burp' || b.burp === 1) &&
        !(LOGGED_AS[r.action] && logged.has(LOGGED_AS[r.action]!)) &&
        !sent.get(b.id, r.id, day),
    );
    // The same words twice (two photo rules on one day) say it once.
    const body = [...new Set(mine.map(ruleText))].join(' ');
    if (!body) continue;
    due.push({
      batch_id: b.id,
      day,
      rule_ids: mine.map((r) => r.id),
      notice: { title: `#${b.number}${b.name ? ` ${b.name}` : ''} · Day ${day}`, body, url: `/b/${b.id}`, tag: `batch-${b.id}` },
    });
  }
  return due;
}

export interface NudgeDeps {
  db: DB;
  timeZone: string;
  send: PushSender;
}

/** Sends what is due; a reminder counts as sent once a device got it. */
export async function runNudges({ db, timeZone, send }: NudgeDeps, now = new Date()): Promise<number> {
  if (!db.prepare('SELECT 1 FROM push_subscriptions LIMIT 1').get()) return 0;
  const record = db.prepare('INSERT OR IGNORE INTO reminders_sent (batch_id, rule_id, day, sent_at) VALUES (?, ?, ?, ?)');
  let sent = 0;
  for (const n of dueNudges(db, now, timeZone)) {
    if ((await pushTo(db, send, n.notice)) === 0) continue;
    for (const id of n.rule_ids) record.run(n.batch_id, id, n.day, now.toISOString());
    sent++;
  }
  return sent;
}

/** Checks every few minutes; returns a function that stops it. */
export function startNudges(deps: NudgeDeps): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runNudges(deps)
      .catch((err) => console.error('Nudges failed:', err))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, EVERY_MS);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
