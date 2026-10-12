import '../styles/jogpad.css';
import { App, createStore, HostProvider, runGesture, type Store, type Unlisten } from '@jogpad/ui';
import { useEffect, useRef, useState } from 'react';
import { createWebHost, startResizing } from '../web-host.ts';

/**
 * The real panel, docked in the page. Same gesture rule as the desktop: the
 * host only reports where the keyboard is and what is selected.
 */
export function Demo() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [host] = useState(() =>
    createWebHost({
      panel: () => wrapperRef.current,
      onShow: () => {
        wrapperRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      },
      onDetach: () => setIsDetached(true),
    }),
  );

  useEffect(() => {
    let unlisten: Unlisten | undefined;
    void (async () => {
      const created = await createStore(host);
      setStore(created);
      unlisten = await host.onGesture(g => void runGesture(g, created, host));
    })();
    return () => unlisten?.();
  }, [host]);

  // The slot holds the panel's size before the store lands so the page does
  // not jump, and keeps holding it once the panel is dragged out of flow.
  return (
    <div className={isDetached ? 'demo-slot detached' : 'demo-slot'}>
      <div ref={wrapperRef} className="dark demo-panel">
        {store && (
          <HostProvider host={host} store={store}>
            <App />
          </HostProvider>
        )}
        {isDetached &&
          ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].map(edge => (
            <div
              key={edge}
              className="demo-edge"
              data-edge={edge}
              onPointerDown={e => {
                if (wrapperRef.current) startResizing(wrapperRef.current, edge, e.nativeEvent);
              }}
            />
          ))}
      </div>
      {isDetached && (
        <button
          type="button"
          onClick={() => {
            const panel = wrapperRef.current;
            if (panel) {
              panel.classList.remove('detached');
              panel.removeAttribute('style');
            }
            setIsDetached(false);
          }}
        >
          JogPad is floating over the page. Tap Shift twice to reach it, or click here to put it
          back.
        </button>
      )}
    </div>
  );
}
