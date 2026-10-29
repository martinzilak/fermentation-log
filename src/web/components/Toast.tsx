// The Undo toast (SPEC §8.1 item 4): every action shows one for 8 s instead
// of asking for confirmation. It renders inside the screen footer, above the
// actions, so it never covers the button the next tap is aimed at.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { HttpError, OfflineError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const DURATION_MS = 8000;

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  undo: (() => unknown) | null;
}

export interface ToastApi {
  show(message: string, undo?: () => unknown): void;
  error(message: string): void;
  /** Runs a save; on failure shows why and resolves to undefined. */
  run<T>(action: () => Promise<T>): Promise<T | undefined>;
}

const Ctx = createContext<{ toast: Toast | null; api: ToastApi; dismiss(): void } | null>(null);

export function errorMessage(err: unknown): string {
  if (err instanceof OfflineError) return t('common.offline');
  if (err instanceof HttpError) return t('common.failed', { error: err.message });
  return t('common.failed', { error: err instanceof Error ? err.message : String(err) });
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const api = useMemo<ToastApi>(() => {
    const open = (next: Omit<Toast, 'id'>) => {
      window.clearTimeout(timer.current);
      const id = ++seq.current;
      setToast({ id, ...next });
      timer.current = window.setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), DURATION_MS);
    };
    const self: ToastApi = {
      show: (message, undo) => open({ message, tone: 'info', undo: undo ?? null }),
      error: (message) => open({ message, tone: 'error', undo: null }),
      run: async (action) => {
        try {
          return await action();
        } catch (err) {
          self.error(errorMessage(err));
          return undefined;
        }
      },
    };
    return self;
  }, []);

  const value = useMemo(() => ({ toast, api, dismiss }), [toast, api, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx.api;
}

export function ToastSlot() {
  const ctx = useContext(Ctx);
  const toast = ctx?.toast;
  if (!ctx || !toast) return null;

  const undo = async () => {
    const action = toast.undo!;
    ctx.dismiss();
    try {
      await action();
    } catch (err) {
      ctx.api.error(t('common.undoFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      className={cn(
        'relative flex items-center gap-3 overflow-hidden rounded-xl border pl-4',
        toast.tone === 'error' ? 'border-danger bg-danger/10' : 'bg-card',
      )}
    >
      <p className="flex-1 py-2 text-lg font-medium">{toast.message}</p>
      {toast.undo && (
        <Button variant="ghost" className="border-l rounded-none px-6 text-xl font-semibold" onClick={() => void undo()}>
          {t('common.undo')}
        </Button>
      )}
      <div
        className="absolute bottom-0 left-0 h-1 bg-primary"
        style={{ animation: `toast-timer ${DURATION_MS}ms linear forwards` }}
      />
    </div>
  );
}
