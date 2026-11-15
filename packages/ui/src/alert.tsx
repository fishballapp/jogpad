import { XIcon } from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * A failure the reader has to act on. It stays until dismissed or until the
 * same action (its `key`) succeeds, unlike the pill, which is for results.
 */
type Alert = { key: string; message: string };

type Alerts = {
  /** `message` is the reader's sentence and next step; `cause` goes to the log only. */
  raise(key: string, message: string, cause: unknown): void;
  clear(key: string): void;
};

const AlertContext = createContext<Alerts | null>(null);

/** The raw error behind a sentence shown on screen, for whoever debugs it. */
export function logFailure(message: string, cause: unknown): void {
  // biome-ignore lint/suspicious/noConsole: the webview's console is the app's only log; the reader sees the sentence
  console.error(message, cause);
}

export function useAlertState() {
  const [alert, setAlert] = useState<Alert | null>(null);
  const raise = useCallback((key: string, message: string, cause: unknown) => {
    logFailure(message, cause);
    setAlert({ key, message });
  }, []);
  const clear = useCallback((key: string) => setAlert(a => (a?.key === key ? null : a)), []);
  const alerts = useMemo(() => ({ raise, clear }), [raise, clear]);
  return { alert, alerts, dismiss: () => setAlert(null) };
}

export const AlertProvider = AlertContext.Provider;

/** For the slots the desktop passes into `App`, which raise into its banner. */
export function useAlerts(): Alerts {
  const alerts = useContext(AlertContext);
  if (!alerts) throw new Error('useAlerts called outside <AlertProvider>');
  return alerts;
}

export function AlertBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex shrink-0 items-start gap-2 bg-destructive/15 px-3 py-2">
      <p className="flex-1 text-xs text-destructive">{message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-destructive/70 hover:text-destructive"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
