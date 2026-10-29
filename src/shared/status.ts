// Automatic batch status (SPEC §6.3). A status set by hand overrides this.
import type { BatchStatus, EventType, StepType } from './schemas.ts';

export function autoStatus(
  steps: { type: StepType; position: number; date: string | null }[],
  events: { type: EventType }[],
): BatchStatus {
  if (events.some((e) => e.type === 'bottled')) return 'bottled';
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const ferment = ordered.find((s) => s.type === 'ferment');
  const later = ferment ? ordered.filter((s) => s.position > ferment.position) : ordered;
  if (later.some((s) => s.date)) return 'processing';
  if (ferment?.date) return 'fermenting';
  return 'planned';
}
