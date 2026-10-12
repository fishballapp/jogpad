import {
  App,
  createStore,
  HostProvider,
  PanelMenu,
  PermissionBanner,
  PreviewWindow,
  runGesture,
  SettingsWindow,
} from '@jogpad/ui';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { browserHost } from './browser-host.ts';
import './index.css';
import { isInTauri, tauriHost } from './tauri-host.ts';

const host = isInTauri ? tauriHost : browserHost;
const store = await createStore(host);
const which = new URLSearchParams(location.search).get('window');

// Rust broadcasts the gesture to every window and the other windows run this
// same bundle, so only the panel may act on it or a capture lands twice.
if (!which) void host.onGesture(g => void runGesture(g, store, host));

type ErrorBoundaryState = { error: Error | null };

/**
 * Shows a render error instead of a blank panel: a blank panel looks exactly
 * like a crash, yet the process is alive, no report is written, and a shipped
 * app has no console to open.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 rounded-xl border bg-background p-6 text-center">
        <p className="text-sm text-destructive">JogPad hit a bug and stopped drawing.</p>
        <p className="text-xs break-words text-muted-foreground">{String(this.state.error)}</p>
        {/* The web view outlives every show and hide, so without this the panel
            stays dead until the app is quit from the tray. */}
        <button
          onClick={() => location.reload()}
          className="mt-2 rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent"
        >
          Reload
        </button>
      </div>
    );
  }
}

const view = (() => {
  if (which === 'settings') return <SettingsWindow />;
  if (which === 'preview') return <PreviewWindow />;
  return <App menu={<PanelMenu />} notice={<PermissionBanner />} />;
})();

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HostProvider host={host} store={store}>
        {view}
      </HostProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
