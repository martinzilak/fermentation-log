// Nudges (SPEC §9): reminders for fermenting batches, sent by Web Push from
// the reminder hour on, never in the quiet hours (22:00–08:00). Each batch
// gets at most one per ferment day, saying everything due that day; whatever
// was already logged that day is left out. A day whose reminder couldn't go
// out (no device, server down) is tried again until the quiet hours, then let go.
import { daysBetween, localDate } from '../shared/calc.ts';
import type { DB } from './db.ts';
import { wallClock } from './nightly.ts';
import { pushTo, type Notice, type PushSender } from './push.ts';

export const QUIET_FROM = 22;
export const QUIET_UNTIL = 8;
const CHECK_DAYS = [7, 14];
const EVERY_MS = 5 * 60_000;

export interface NudgeSettings {
  hour: number;
  day0Photo: boolean;
  checks: boolean;
  burp: boolean;
  /** 0 when off. */
  readyDays: number;
}

export function nudgeSettings(db: DB): NudgeSettings {
  const rows = new Map(
    (db.prepare("SELECT key, value FROM settings WHERE key LIKE 'nudge_%'").all() as { key: string; value: string }[]).map((r) => [
      r.key,
      Number(r.value),
    ]),
  );
  return {
    hour: rows.get('nudge_hour') ?? 18,
    day0Photo: (rows.get('nudge_day0_photo') ?? 1) !== 0,
    checks: (rows.get('nudge_checks') ?? 1) !== 0,
    burp: (rows.get('nudge_burp') ?? 0) !== 0,
    readyDays: rows.get('nudge_ready_days') ?? 14,
  };
}

export interface Nudge {
  batch_id: string;
  day: number;
  notice: Notice;
}

/** What to say for a batch on its ferment day, leaving out what was logged today. */
export function nudgeText(day: number, s: NudgeSettings, logged: Set<string>): string | null {
  const check = s.checks && CHECK_DAYS.includes(day);
  const photo = ((day === 0 && s.day0Photo) || check) && !logged.has('photo');
  const ph = check && !logged.has('ph');
  const parts = [
    photo && ph ? 'Take a photo and measure the pH.' : photo ? 'Take a photo.' : ph ? 'Measure the pH.' : null,
    s.burp && day >= 1 && !logged.has('burp') ? 'Burp the jar.' : null,
    s.readyDays > 0 && day === s.readyDays ? 'Ready for the next step?' : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(' ') : null;
}

/** The reminders due now that haven't been sent. */
export function dueNudges(db: DB, now: Date, timeZone: string): Nudge[] {
  const s = nudgeSettings(db);
  const { hour } = wallClock(now.getTime(), timeZone);
  if (hour < s.hour || hour >= QUIET_FROM || hour < QUIET_UNTIL) return [];
  const today = localDate(now.toISOString(), timeZone);
  const batches = db
    .prepare(
      `SELECT b.id, b.number, b.name,
              (SELECT s.date FROM steps s WHERE s.batch_id = b.id AND s.type = 'ferment' ORDER BY s.position LIMIT 1) AS ferment_date
         FROM batches b
        WHERE b.deleted_at IS NULL AND b.status = 'fermenting'
        ORDER BY b.number`,
    )
    .all() as { id: string; number: number; name: string | null; ferment_date: string | null }[];
  const sent = db.prepare('SELECT 1 FROM nudges_sent WHERE batch_id = ? AND day = ?');
  // Two days back covers today in any zone.
  const events = db.prepare('SELECT type, occurred_at FROM events WHERE batch_id = ? AND occurred_at >= ?');
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  const due: Nudge[] = [];
  for (const b of batches) {
    if (!b.ferment_date) continue;
    const day = daysBetween(b.ferment_date, today);
    if (day < 0 || sent.get(b.id, day)) continue;
    const logged = new Set(
      (events.all(b.id, since) as { type: string; occurred_at: string }[])
        .filter((e) => localDate(e.occurred_at, timeZone) === today)
        .map((e) => e.type),
    );
    const body = nudgeText(day, s, logged);
    if (!body) continue;
    due.push({
      batch_id: b.id,
      day,
      notice: { title: `#${b.number}${b.name ? ` ${b.name}` : ''} · day ${day}`, body, url: `/b/${b.id}`, tag: `batch-${b.id}` },
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
  let sent = 0;
  for (const n of dueNudges(db, now, timeZone)) {
    if ((await pushTo(db, send, n.notice)) === 0) continue;
    db.prepare('INSERT OR IGNORE INTO nudges_sent (batch_id, day, sent_at) VALUES (?, ?, ?)').run(n.batch_id, n.day, now.toISOString());
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
