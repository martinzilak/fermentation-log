import type { BatchStatus } from '../../shared/schemas.ts';
import { capColor } from '@/lib/format';
import type { HeatWord } from '@/lib/heat';
import { statusLabel, t } from '@/lib/i18n';
import { phLevel, phText } from '@/lib/ph';
import { cn } from '@/lib/utils';

export function ColorDot({ color, className }: { color: string | null; className?: string }) {
  const css = capColor(color);
  if (!css) return null;
  return (
    <span
      aria-hidden
      className={cn('inline-block size-5 shrink-0 rounded-full border border-foreground/30', className)}
      style={{ background: css }}
    />
  );
}

/**
 * The batch number as a label plate, its cap colour as the band on the left
 * (SPEC §15.12); without a colour the band is plain.
 */
export function Plate({ number, color, large = false }: { number: number; color: string | null; large?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-stretch overflow-hidden rounded-md border-2 border-foreground bg-card font-display leading-none font-extrabold tabular-nums',
        large ? 'h-14 text-[2.5rem]' : 'h-12 text-[2rem]',
      )}
    >
      <span aria-hidden className={large ? 'w-3' : 'w-2.5'} style={{ background: capColor(color) ?? 'var(--border)' }} />
      <span className="flex items-center px-2">{number}</span>
    </span>
  );
}

// Live states are neon blocks; the rest stay quiet (SPEC §15.12).
const STATUS_STYLES: Record<BatchStatus, string> = {
  planned: 'border border-foreground text-foreground',
  fermenting: 'bg-fermenting text-on-state',
  processing: 'bg-processing text-on-state',
  bottled: 'bg-secondary text-foreground',
  archived: 'border border-dashed border-input text-muted-foreground',
};

export function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-sm px-2 py-0.5 font-display text-base leading-tight font-bold tracking-wider whitespace-nowrap uppercase',
        STATUS_STYLES[status],
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

/** Heat as five pips with its word, which is always there (SPEC §7.4). */
export function HeatPips({ pips, word }: { pips: number; word: HeatWord }) {
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="font-display text-3xl leading-none font-bold uppercase">{t(`heat.${word}`)}</span>
      <span aria-hidden className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn('size-3 rounded-sm', n <= pips ? 'bg-primary' : 'bg-border')} />
        ))}
      </span>
    </span>
  );
}

const PH_STYLES = { danger: 'bg-danger', warn: 'bg-warn', ok: 'bg-ok' } as const;

/** pH with its colour and, always, its text label (SPEC §7.4). */
export function PhLabel({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span aria-hidden className={cn('inline-block size-4 shrink-0 rounded-full', PH_STYLES[phLevel(value)])} />
      <span>{phText(value)}</span>
    </span>
  );
}
