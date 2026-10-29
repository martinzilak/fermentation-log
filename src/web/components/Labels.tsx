import type { BatchStatus } from '../../shared/schemas.ts';
import { Badge } from '@/components/ui/badge';
import { cssColor } from '@/lib/format';
import { statusLabel } from '@/lib/i18n';
import { phLevel, phText } from '@/lib/ph';
import { cn } from '@/lib/utils';

export function ColorDot({ color, className }: { color: string | null; className?: string }) {
  const css = cssColor(color);
  if (!css) return null;
  return (
    <span
      aria-hidden
      className={cn('inline-block size-5 shrink-0 rounded-full border border-foreground/20', className)}
      style={{ background: css }}
    />
  );
}

export function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <Badge variant={status === 'fermenting' ? 'default' : 'secondary'} className="text-base">
      {statusLabel(status)}
    </Badge>
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
