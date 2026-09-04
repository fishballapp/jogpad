import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { Host, Permissions } from './host.ts';
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
    const unlisten = store.on('notes', setSnapshot);
    return unlisten;
  }, [store]);

  return snapshot;
}

export function usePermissions(): Permissions {
  const host = useHost();
  const [permissions, setPermissions] = useState<Permissions>({
    trusted: false,
    inputMonitoring: false,
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void host.permissions.status().then(p => {
      if (!cancelled) setPermissions(p);
    });

    void host.permissions
      .onChange(p => {
        if (!cancelled) setPermissions(p);
      })
      .then(u => {
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [host]);

  return permissions;
}
