import { type ReactNode, useState } from 'react';
import { PortalProvider } from '../portal';
import { cn } from '../utils';

/// The frame every host draws the pad in: border, radius, background, focus
/// ring, font. Also the portal container for dialogs, menus and tooltips, so
/// they stay inside the frame wherever the frame is.
export function Panel({ focused, children }: { focused: boolean; children: ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setEl}
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-xl border bg-background font-sans text-foreground transition-colors',
        focused ? 'border-ring/80' : 'border-border/30',
      )}
    >
      <PortalProvider value={el}>{children}</PortalProvider>
    </div>
  );
}
