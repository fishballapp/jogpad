import '../styles/jogpad.css';
import { App, createStore, HostProvider, runGesture, type Store } from '@jogpad/ui';
import { useEffect, useRef, useState } from 'react';
import { createWebHost, startResizing } from '../web-host.ts';

/// The real panel, docked where a screenshot used to be. Same gesture rule as
/// the desktop: the host only reports where the keyboard is and what is
/// selected.
export default function Demo() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [detached, setDetached] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const [host] = useState(() =>
    createWebHost({
      panel: () => wrapperRef.current,
      onShow: focus => {
        wrapperRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        if (focus) storeRef.current?.emit('focus-input', undefined);
      },
      onDetach: () => setDetached(true),
    }),
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void createStore(host).then(s => {
      setStore(s);
      void host
        .onGesture(g => void runGesture(g, s, host))
        .then(u => {
          unlisten = u;
        });
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [host]);

  // The slot holds the panel's size before the store lands so the page does
  // not jump, and keeps holding it once the panel is dragged out of flow.
  return (
    <div className={detached ? 'demo-slot detached' : 'demo-slot'}>
      <div ref={wrapperRef} className="dark demo-panel">
        {store && (
          <HostProvider host={host} store={store}>
            <App />
          </HostProvider>
        )}
        {detached &&
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
      {detached && (
        <button
          type="button"
          onClick={() => {
            const panel = wrapperRef.current;
            if (panel) {
              panel.classList.remove('detached');
              panel.removeAttribute('style');
            }
            setDetached(false);
          }}
        >
          JogPad is floating over the page. Tap Shift twice to reach it, or click here to put it
          back.
        </button>
      )}
    </div>
  );
}
