// Salt against the target (SPEC §8.2 item 2). A warning, never a block: the
// weighing screen and the batch say so, and Done still leaves.
import { t } from './i18n.ts';
import { formatPct } from './numbers.ts';

export type SaltOff = 'none' | 'low' | 'high';

/** Null while the salt is within half a point under to a point over the target. */
export function saltOff(pct: number | null, target: number): SaltOff | null {
  if (pct === null || pct <= 0) return 'none';
  if (pct < target - 0.5) return 'low';
  if (pct > target + 1) return 'high';
  return null;
}

export function saltWarning(pct: number | null, target: number): string | null {
  const off = saltOff(pct, target);
  return off && t(`salt.${off}`, { pct: formatPct(pct ?? 0), target: formatPct(target) });
}
