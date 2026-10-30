// Screen layout with a single scroller, the page itself: the title sticks to
// the top and every action to the bottom (thumb zone, SPEC §8.1 item 2), and
// content scrolls between them. No inner scroll area, so a scroll gesture
// never has to pick between two. The Undo toast sits just above the actions,
// and safe-area insets keep standalone mode clear of the notch and home bar.
// Installed, the screen is at least 100lvh tall: iOS 26 starts a Home Screen
// app with 100dvh short by the status bar, which left a gap under the footer.
import type { ReactNode } from 'react';
import { ConnectionBanner, useBanner } from '@/components/ConnectionBanner';
import { ToastSlot } from '@/components/Toast';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
}

const sides = { paddingLeft: 'max(1rem, env(safe-area-inset-left))', paddingRight: 'max(1rem, env(safe-area-inset-right))' };

export function Screen({ title, subtitle, children, footer }: Props) {
  const banner = useBanner();
  return (
    <div className="flex min-h-dvh flex-col standalone:min-h-lvh">
      <header className="sticky top-0 z-10 bg-background">
        {banner && <ConnectionBanner state={banner} />}
        {/* The banner, when shown, already clears the notch. */}
        <div className="pb-2" style={{ ...sides, paddingTop: banner ? '1rem' : 'max(1rem, env(safe-area-inset-top))' }}>
          <h1 className="text-2xl leading-tight font-bold">{title}</h1>
          {subtitle && <div className="mt-1 text-lg text-muted-foreground">{subtitle}</div>}
        </div>
      </header>
      <main className="flex-1 pb-4" style={sides}>
        {children}
      </main>
      <footer
        className="sticky bottom-0 z-10 flex flex-col gap-3 border-t bg-background pt-3"
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
