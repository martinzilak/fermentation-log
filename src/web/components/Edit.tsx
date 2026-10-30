// Building blocks for the edit screens (SPEC §8.2 items 5, 7, 8, 10). Every
// field saves on its own when it loses focus or a chip is tapped, with an
// Undo toast; there is no Save button (SPEC §8.1 items 4 and 13). Weights are
// not typed here: those open the numpad.
import { ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { formatDay } from '@/lib/format';
import { t } from '@/lib/i18n';
import { parseDecimal } from '@/lib/numbers';
import { acceptPress } from '@/lib/press';
import { invalidate } from '@/lib/query';

type Values = Record<string, unknown>;

/**
 * Returns save(patch, before): PATCHes `url`, refetches every cached URL under
 * the `refreshes` prefixes, and offers Undo, which PATCHes `before` back.
 * Resolves to whether the save went through.
 */
export function usePatch(url: string, refreshes: string[]) {
  const toast = useToast();
  const reload = () => refreshes.forEach(invalidate);
  return async (patch: Values, before: Values, message: string = t('edit.saved')): Promise<boolean> => {
    const saved = await toast.run(() => api.patch(url, patch));
    reload();
    if (saved === undefined) return false;
    toast.show(message, async () => {
      await api.patch(url, before);
      reload();
    });
    return true;
  };
}

export function Section({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title && <h2 className="mb-2 text-lg text-muted-foreground">{title}</h2>}
      {children}
    </section>
  );
}

interface TextFieldProps {
  label: string;
  value: string | null;
  /** Called with the trimmed text, or null when emptied; resolves to whether it saved. */
  onSave: (value: string | null) => Promise<boolean>;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string | undefined;
  inputMode?: 'text' | 'decimal' | 'numeric';
  /** The id of a <datalist> to suggest from. */
  list?: string | undefined;
}

/** A text field that saves when it loses focus (or on Enter), if it changed. */
export function TextField({ label, value, onSave, multiline = false, required = false, placeholder, inputMode, list }: TextFieldProps) {
  const [text, setText] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value ?? '');
  }, [value, focused]);

  async function commit() {
    setFocused(false);
    const next = text.trim() || null;
    if (next === (value ?? null)) return setText(value ?? '');
    if (next === null && required) return setText(value ?? '');
    if (!(await onSave(next))) setText(value ?? '');
  }

  const common = {
    'aria-label': label,
    value: text,
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => void commit(),
  };
  return (
    <label className="block">
      <span className="mb-1 block text-lg text-muted-foreground">{label}</span>
      {multiline ? (
        <Textarea {...common} onChange={(e) => setText(e.target.value)} />
      ) : (
        <Input
          {...common}
          inputMode={inputMode}
          list={list}
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      )}
    </label>
  );
}

/**
 * A date that saves when its picker closes. The box shows the date as text and
 * the native input lies invisible on top: iOS sizes a visible date input to
 * its own content, wider than the screen.
 */
export function DateField({ label, value, onSave }: { label: string; value: string | null; onSave: (value: string | null) => Promise<boolean> }) {
  const [date, setDate] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDate(value ?? '');
  }, [value, focused]);

  async function commit() {
    setFocused(false);
    const next = date || null;
    if (next === value) return;
    if (!(await onSave(next))) setDate(value ?? '');
  }

  return (
    <label className="block">
      <span className="mb-1 block text-lg text-muted-foreground">{label}</span>
      <span className="relative flex h-14 items-center overflow-hidden rounded-xl border border-input px-4 text-lg shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
        {date ? formatDay(date) : <span className="text-muted-foreground">{t('edit.noDate')}</span>}
        <input
          type="date"
          aria-label={label}
          value={date}
          onFocus={() => setFocused(true)}
          onBlur={() => void commit()}
          onChange={(e) => setDate(e.target.value)}
          // Desktop browsers open the picker only from their own icon.
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch {
              // Already open, or a browser without showPicker.
            }
          }}
          className="absolute inset-0 size-full min-w-0 opacity-0"
        />
      </span>
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  onSave: (value: number | null) => Promise<boolean>;
  min?: number;
  max?: number;
  integer?: boolean;
  required?: boolean;
  placeholder?: string | undefined;
}

/** A number that isn't a weight (SHU, ml, °C, %): the decimal keyboard, saved on blur. */
export function NumberField({ label, value, onSave, min = 0, max = Infinity, integer = false, required = false, placeholder }: NumberFieldProps) {
  const toast = useToast();
  return (
    <TextField
      label={label}
      value={value === null ? null : String(value)}
      inputMode={integer ? 'numeric' : 'decimal'}
      required={required}
      placeholder={placeholder}
      onSave={async (text) => {
        if (text === null) return onSave(null);
        const n = parseDecimal(text);
        if (n === null || n < min || n > max || (integer && !Number.isInteger(n))) {
          toast.error(t('edit.badNumber', { label }));
          return false;
        }
        return onSave(n);
      }}
    />
  );
}

/** A big list row that opens something. */
export function LinkRow({ title, hint, onClick }: { title: ReactNode; hint?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => acceptPress(e) && onClick()}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card px-4 py-2 text-left active:bg-accent"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg font-medium">{title}</span>
        {hint && <span className="text-base text-muted-foreground">{hint}</span>}
      </span>
      <ChevronRight className="size-6 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Rows stay 12 px apart, so a wet finger can't land between two (SPEC §8.1 item 1). */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
