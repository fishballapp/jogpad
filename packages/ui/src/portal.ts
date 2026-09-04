import { createContext, useContext } from 'react';

/// Set by `Panel`. Unset means document.body, which only the settings window uses.
const PortalContext = createContext<HTMLElement | null>(null);

export const PortalProvider = PortalContext.Provider;

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContext) ?? undefined;
}
