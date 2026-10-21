import { cn } from 'cn';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { PortalProvider } from '../portal.ts';

/**
 * The frame every host draws the pad in: border, radius, background, focus
 * ring, font. Also the portal container for dialogs, menus and tooltips, so
 * they stay inside the frame wherever the frame is. Other div props land on
 * the frame, which is how the pad takes a file drop anywhere inside it.
 */
export function Panel({
  isFocused,
  children,
  className,
  ...rest
}: { isFocused: boolean; children: ReactNode } & ComponentProps<'div'>) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setEl}
      {...rest}
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-xl border bg-background font-sans text-foreground transition-colors',
        isFocused ? 'border-ring/80' : 'border-border/30',
        className,
      )}
    >
      <PortalProvider value={el}>{children}</PortalProvider>
    </div>
  );
}
