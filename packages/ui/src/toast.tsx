import { useCallback, useState } from 'react';

/// A message that shows for a moment. `flash` is what to draw right now,
/// null when nothing is; `toast` puts a new one up.
export function useToast() {
  const [flash, setFlash] = useState<string | null>(null);
  const toast = useCallback((message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(f => (f === message ? null : f)), 1600);
  }, []);
  return { flash, toast };
}

/// The pill at the top of the panel. Sits inside `Panel`, which is the
/// positioned ancestor it centres against.
export function Flash({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
      <span className="rounded-full bg-foreground px-2.5 py-1 text-xs text-background shadow">
        {message}
      </span>
    </div>
  );
}
