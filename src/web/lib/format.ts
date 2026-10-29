// Dates and colours for display. Date-only values are calendar days and are
// formatted in UTC so they never shift; timestamps use the device's zone.
import { localDate } from '../../shared/calc.ts';

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const stamp = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatDay = (isoDate: string) => day.format(new Date(`${isoDate}T00:00:00Z`));
export const formatStamp = (iso: string) => stamp.format(new Date(iso));

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Today's date on this device, YYYY-MM-DD. */
export function todayIso(offsetDays = 0): string {
  return localDate(new Date(Date.now() + offsetDays * 86_400_000).toISOString(), zone);
}

/** "Day N" of a ferment: the start date is day 1. The API counts days elapsed (0 on the start date). */
export const dayNumber = (fermentDay: number) => fermentDay + 1;

/** A batch colour usable in CSS, or null for free text the browser doesn't know. */
export function cssColor(color: string | null): string | null {
  return color && CSS.supports('color', color) ? color : null;
}
