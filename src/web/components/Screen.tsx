// Screen layout: a title at the top, content in the middle, and every action
// in a footer pinned to the bottom (thumb zone, SPEC §8.1 item 2), with the
// Undo toast just above the actions. Safe-area insets keep standalone mode
// clear of the notch and the home indicator.
import type { ReactNode } from 'react';
import { ToastSlot } from '@/components/Toast';
import { cn } from '@/lib/utils';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  /** Flow screens fill the viewport without scrolling (SPEC §8.1 item 7). */
  fixed?: boolean;
}

const sides = { paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' };

export function Screen({ title, subtitle, children, footer, fixed = false }: Props) {
  return (
    <div className={cn('flex flex-col', fixed ? 'h-dvh overflow-hidden' : 'min-h-dvh')}>
      <header className="pb-2" style={{ ...sides, paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <h1 className="text-2xl leading-tight font-bold">{title}</h1>
        {subtitle && <div className="mt-1 text-lg text-muted-foreground">{subtitle}</div>}
      </header>
      <main className={cn('flex-1 pb-4', fixed && 'min-h-0 overflow-y-auto')} style={sides}>
        {children}
      </main>
      <footer
        className="sticky bottom-0 flex flex-col gap-3 border-t bg-background pt-3"
        style={{ ...sides, paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <ToastSlot />
        {footer}
      </footer>
    </div>
  );
}

/** A row of equal-width footer buttons. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="grid auto-cols-fr grid-flow-col gap-3">{children}</div>;
}
