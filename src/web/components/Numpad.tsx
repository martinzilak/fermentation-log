// Custom numpad for weights and pH (SPEC §8.1 item 5): a 3×4 grid of huge
// keys instead of the iOS keyboard. A hardware keyboard works too, with a
// comma or a dot for decimals and Enter for Next.
import { Delete } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { keepUnits } from '@/lib/caps';
import { appendKey, parseDecimal } from '@/lib/numbers';
import { justPressed } from '@/lib/press';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  decimals?: number;
  maxInt?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;

export function Numpad({ value, onChange, onEnter, decimals = 2, maxInt = 6 }: Props) {
  const latest = useRef({ value, onChange, onEnter });
  latest.current = { value, onChange, onEnter };

  const press = (key: string) => {
    const { value, onChange } = latest.current;
    onChange(appendKey(value, key, { decimals, maxInt }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') latest.current.onEnter?.();
      else if (e.key === 'Backspace') press('back');
      else if (/^[\d.,]$/.test(e.key)) press(e.key);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === 'back' ? t('numpad.delete') : key === '.' ? t('numpad.decimal') : key}
          disabled={key === '.' && decimals === 0}
          // A double tap on the button that opened this screen must not type a digit.
          onClick={(e) => !justPressed(e) && press(key)}
          // Keycaps: a darker bottom edge that flattens when pressed.
          className="flex h-14 items-center justify-center rounded-lg bg-secondary font-display text-4xl font-bold text-secondary-foreground tabular-nums shadow-[inset_0_-3px_0_var(--accent)] active:translate-y-px active:bg-accent active:shadow-none disabled:opacity-30"
        >
          {key === 'back' ? <Delete className="size-9" /> : key}
        </button>
      ))}
    </div>
  );
}

interface ReadoutProps {
  value: string;
  unit?: string;
  /** Top row, left and right: what the number is, and context such as the plan. */
  label?: ReactNode;
  aside?: ReactNode;
  /** Bottom row, left and right: the net, and a tag such as the deviation. */
  below?: ReactNode;
  tag?: ReactNode;
  /** How far towards the plan, 1 being on it: draws the ruler. */
  fill?: number | null;
}

/**
 * The number being typed, on a panel like a scale's display (SPEC §15.12),
 * at least 48 px (SPEC §8.1 item 6). Nothing typed shows a dim 0, so it
 * doesn't read as a measurement.
 */
export function Readout({ value, unit, label, aside, below, tag, fill }: ReadoutProps) {
  const row = 'flex items-baseline justify-between gap-3 font-mono text-sm tracking-wider text-lcd-muted uppercase';
  return (
    <div className="rounded-xl bg-lcd px-4 py-3 text-lcd-foreground">
      {(label || aside) && (
        <div className={row}>
          <span>{keepUnits(label)}</span>
          <span className="text-right">{keepUnits(aside)}</span>
        </div>
      )}
      <p className="text-right font-display text-7xl leading-none font-bold tabular-nums" aria-live="polite">
        <span className={cn(!value && 'text-lcd-muted')}>{value || '0'}</span>
        {unit && <span className="ml-1 text-4xl">{unit}</span>}
      </p>
      {fill != null && <Ruler fill={fill} />}
      {(below || tag) && (
        <div className={cn(row, 'mt-1')}>
          <span>{keepUnits(below)}</span>
          {tag && <span className="rounded-sm bg-lcd-tick px-1.5 text-lcd-foreground">{keepUnits(tag)}</span>}
        </div>
      )}
    </div>
  );
}

/** Ticks every few grams, filled up to the weight; the bar at the end is the plan. */
function Ruler({ fill }: { fill: number }) {
  const ticks = (color: string, width: number) => `repeating-linear-gradient(90deg, ${color} 0 ${width}px, transparent ${width}px 8px)`;
  return (
    <div aria-hidden className="relative mt-2 h-3" style={{ backgroundImage: ticks('var(--lcd-tick)', 1) }}>
      <div className="absolute inset-y-0 left-0" style={{ width: `${Math.min(Math.max(fill, 0), 1) * 100}%`, backgroundImage: ticks('var(--lcd-foreground)', 2) }} />
      <div className="absolute -inset-y-1 right-0 w-0.5 bg-lcd-foreground" />
    </div>
  );
}

interface FooterProps extends Omit<Props, 'onEnter'> {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
}

/** Keypad plus Back and a wide Next (enabled once a number is typed), for a screen footer. */
export function NumpadFooter({ onBack, onNext, nextLabel = t('common.next'), ...pad }: FooterProps) {
  return (
    <>
      <Numpad {...pad} onEnter={onNext} />
      <div className="grid grid-cols-3 gap-3">
        <Button variant="outline" className="h-16" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button size="lg" className="col-span-2" disabled={parseDecimal(pad.value) === null} onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </>
  );
}
