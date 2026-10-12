import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { Host, Permissions, Unlisten } from './host.ts';
import type { Snapshot, Store } from './store.ts';

const HostContext = createContext<{ host: Host; store: Store } | null>(null);

export function HostProvider({
  host,
  store,
  children,
}: {
  host: Host;
  store: Store;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ host, store }), [host, store]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHost(): Host {
  const ctx = useContext(HostContext);
  if (!ctx) throw new Error('useHost called outside <HostProvider>');
  return ctx.host;
}

export function useStore(): Store {
  const ctx = useContext(HostContext);
  if (!ctx) throw new Error('useStore called outside <HostProvider>');
  return ctx.store;
}

export function useSnapshot(): Snapshot {
  const store = useStore();
  const [snapshot, setSnapshot] = useState<Snapshot>(() => store.snapshot());

  useEffect(() => {
    setSnapshot(store.snapshot());
    return store.on('notes', setSnapshot);
  }, [store]);

  return snapshot;
}

export function usePermissions(): Permissions {
  const host = useHost();
  const [permissions, setPermissions] = useState<Permissions>({
    isTrusted: false,
    isInputMonitoringGranted: false,
  });

  useEffect(() => {
    let unlisten: Unlisten | undefined;
    let isCancelled = false;

    void (async () => {
      const status = await host.permissions.status();
      if (!isCancelled) setPermissions(status);
    })();

    void (async () => {
      const stop = await host.permissions.onChange(p => {
        if (!isCancelled) setPermissions(p);
      });
      if (isCancelled) {
        stop();
        return;
      }
      unlisten = stop;
    })();

    return () => {
      isCancelled = true;
      unlisten?.();
    };
  }, [host]);

  return permissions;
}

/**
 * The one permission to ask for next, or null when both are held.
 * Accessibility is the prerequisite, and Input Monitoring follows from it
 * without a prompt, so naming both at once would send people hunting for a
 * permission they never have to grant by hand.
 */
export function missingPermission({
  isTrusted,
  isInputMonitoringGranted,
}: Permissions): string | null {
  if (!isTrusted) return 'Accessibility';
  if (!isInputMonitoringGranted) return 'Input Monitoring';
  return null;
}
