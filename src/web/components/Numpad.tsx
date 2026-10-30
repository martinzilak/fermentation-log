// Custom numpad for weights and pH (SPEC §8.1 item 5): a 3×4 grid of huge
// keys instead of the iOS keyboard. A hardware keyboard works too, with a
// comma or a dot for decimals and Enter for Next.
import { Delete } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { appendKey, parseDecimal } from '@/lib/numbers';
import { justPressed } from '@/lib/press';

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
          className="flex h-14 items-center justify-center rounded-xl bg-secondary text-4xl font-semibold text-secondary-foreground tabular-nums active:bg-accent disabled:opacity-30"
        >
          {key === 'back' ? <Delete className="size-9" /> : key}
        </button>
      ))}
    </div>
  );
}

/** The number being typed, at least 48 px (SPEC §8.1 item 6): text-5xl is 54 px. */
export function Readout({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="text-5xl font-bold tabular-nums" aria-live="polite">
      {value || '0'}
      {unit && <span className="ml-2 text-3xl font-medium text-muted-foreground">{unit}</span>}
    </p>
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
