// Choice chips (SPEC §8.1 item 12): big, wrapping, tap-only.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChipProps {
  children: ReactNode;
  hint?: ReactNode;
  selected?: boolean;
  onClick: () => void;
  className?: string;
}

export function Chip({ children, hint, selected = false, onClick, className }: ChipProps) {
  return (
    <Button
      variant={selected ? 'selected' : 'outline'}
      aria-pressed={selected}
      onClick={onClick}
      // Choices are names (peppers, people's words), so they keep their case.
      className={cn('h-auto min-h-14 flex-col items-start gap-0 py-2 text-left font-sans text-lg font-semibold tracking-normal whitespace-normal normal-case', className)}
    >
      <span>{children}</span>
      {hint && <span className={cn('text-base', selected ? 'opacity-80' : 'text-muted-foreground')}>{hint}</span>}
    </Button>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}
