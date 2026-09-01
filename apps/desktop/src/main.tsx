import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/// A render error used to unmount everything and leave a blank panel, which
/// looks exactly like a crash: the process is still alive, no report is
/// written, and there is no console to open in a shipped app. Show the error
/// instead, so the next one can be reported rather than guessed at.
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
