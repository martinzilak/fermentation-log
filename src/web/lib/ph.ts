// pH display rule (SPEC §7.4): information, never a blocker, and always with
// a text label next to the colour.
import { t } from './i18n.ts';

export type PhLevel = 'danger' | 'warn' | 'ok';

export function phLevel(value: number): PhLevel {
  if (value >= 4.6) return 'danger';
  if (value >= 4.0) return 'warn';
  return 'ok';
}

export const phText = (value: number) => t(`ph.${phLevel(value)}`);
