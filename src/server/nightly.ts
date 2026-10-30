// The nightly job (SPEC §10.2): at 03:00 local time, a full export to
// DATA_DIR/exports/ and a VACUUM INTO snapshot in DATA_DIR/backups/, keeping
// the last 14. A night missed while the server was down runs on start-up.
import path from 'node:path';
import { localDate } from '../shared/calc.ts';
import { lastNightlyBackup, nightlyBackup } from './backup.ts';
import type { DB } from './db.ts';
import { writeExport } from './export.ts';

export const NIGHTLY_HOUR = 3;
export const NIGHTLY_BACKUPS_KEPT = 14;

export interface NightlyDeps {
  db: DB;
  dataDir: string;
  mediaDir: string;
  timeZone: string;
}

export function wallClock(t: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

/** The instant a local wall-clock time occurs in `timeZone`. */
function instant(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const wanted = Date.UTC(year, month - 1, day, hour);
  let t = wanted;
  // Two passes settle the offset, including on a DST change day.
  for (let i = 0; i < 2; i++) {
    const w = wallClock(t, timeZone);
    t += wanted - Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  }
  return t;
}

/** The next NIGHTLY_HOUR:00 local time after `now`. */
export function nextNightly(now: Date, timeZone: string): Date {
  const w = wallClock(now.getTime(), timeZone);
  const today = instant(w.year, w.month, w.day, NIGHTLY_HOUR, timeZone);
  if (today > now.getTime()) return new Date(today);
  const tomorrow = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return new Date(instant(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), NIGHTLY_HOUR, timeZone));
}

/** Whether tonight's run (the latest NIGHTLY_HOUR:00 already past) has no snapshot. */
export function missedNightly(now: Date, timeZone: string, backupsDir: string): boolean {
  const w = wallClock(now.getTime(), timeZone);
  const due = w.hour >= NIGHTLY_HOUR ? localDate(now.toISOString(), timeZone) : localDate(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
  const last = lastNightlyBackup(backupsDir);
  return last === null || last < due;
}

export function runNightly({ db, dataDir, mediaDir, timeZone }: NightlyDeps, now = new Date()): void {
  try {
    const files = writeExport({ db, mediaDir, timeZone, now }, path.join(dataDir, 'exports'));
    const backup = nightlyBackup(db, path.join(dataDir, 'backups'), localDate(now.toISOString(), timeZone), NIGHTLY_BACKUPS_KEPT);
    console.log(`Nightly: exported ${files} files, backup ${path.basename(backup)}`);
  } catch (err) {
    console.error('Nightly export or backup failed:', err);
  }
}

/** Schedules the nightly job; returns a function that stops it. */
export function startNightly(deps: NightlyDeps): () => void {
  let timer: NodeJS.Timeout | undefined;
  const schedule = () => {
    timer = setTimeout(() => {
      runNightly(deps);
      schedule();
    }, nextNightly(new Date(), deps.timeZone).getTime() - Date.now());
    timer.unref();
  };
  if (missedNightly(new Date(), deps.timeZone, path.join(deps.dataDir, 'backups'))) runNightly(deps);
  schedule();
  return () => clearTimeout(timer);
}
