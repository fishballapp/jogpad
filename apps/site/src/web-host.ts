import type { FileName, GestureInput, Host } from '@jogpad/ui';

export const demoMarkdown = `## Try it

- [ ] Select any text on this page and tap Shift twice. It lands here.
- [ ] Tick a few items, then ⌘⇧C copies them as a numbered list.
- [ ] Drag this header and the panel floats over the page. Pull any edge to resize it.
- [x] ⌘K switches pages

## Bug 412

- [ ] TypeError: Cannot read properties of undefined (reading 'items')
- [ ] Repro: sign out while a sync is in flight
- [ ] The retry loop in sync.ts backs off 1s, 2s, 4s, then gives up.
- [x] Which commit added the backoff?

## Reading

- [ ] A listen-only event tap cannot swallow keystrokes, which matters
  because swallowing Shift would break every capital letter.
- [ ] macOS ties the Accessibility grant to the app's path.
- [ ] https://github.com/ahkohd/tauri-nspanel
`;

/// Edge and corner resize for the detached panel, the way a macOS window
/// resizes: no handle, the cursor changes near the border. `edge` is one or
/// two of n/e/s/w. Called from a pointerdown on the edge strip.
export function startResizing(panel: HTMLElement, edge: string, e: PointerEvent) {
  const minW = 280;
  const minH = 240;
  const r = panel.getBoundingClientRect();
  const strip = e.currentTarget as HTMLElement;
  strip.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    if (edge.includes('e')) panel.style.width = `${Math.max(minW, m.clientX - r.left)}px`;
    if (edge.includes('s')) panel.style.height = `${Math.max(minH, m.clientY - r.top)}px`;
    if (edge.includes('w')) {
      const left = Math.min(m.clientX, r.right - minW);
      panel.style.left = `${left}px`;
      panel.style.width = `${r.right - left}px`;
    }
    if (edge.includes('n')) {
      const top = Math.min(m.clientY, r.bottom - minH);
      panel.style.top = `${top}px`;
      panel.style.height = `${r.bottom - top}px`;
    }
  };
  const up = () => {
    strip.removeEventListener('pointermove', move);
    strip.removeEventListener('pointerup', up);
    strip.removeEventListener('pointercancel', up);
  };
  strip.addEventListener('pointermove', move);
  strip.addEventListener('pointerup', up);
  strip.addEventListener('pointercancel', up);
  e.preventDefault();
}

export function createWebHost(opts: {
  panel: () => HTMLElement | null;
  onShow: (focus: boolean) => void;
  /// First drag. The page swaps in a placeholder where the panel was.
  onDetach: () => void;
}): Host {
  const files = new Map<FileName, string>([['notes.md', demoMarkdown]]);
  const watchers = new Map<FileName, Set<() => void>>();

  // startDragging gets no event, so remember where the last press was. The
  // listener is installed with the gesture listener below, which owns cleanup.
  const pointer = { x: 0, y: 0, id: 0, target: null as Element | null };
  const onPointerDown = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.id = e.pointerId;
    pointer.target = e.target instanceof Element ? e.target : null;
  };

  const startDragging = () => {
    const panel = opts.panel();
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const dx = pointer.x - rect.left;
    const dy = pointer.y - rect.top;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.classList.add('detached');
    opts.onDetach();
    // A panel resized past the viewport still keeps its top-left reachable.
    const maxX = Math.max(0, innerWidth - rect.width);
    const maxY = Math.max(0, innerHeight - rect.height);
    const move = (e: { clientX: number; clientY: number }) => {
      panel.style.left = `${Math.min(Math.max(0, e.clientX - dx), maxX)}px`;
      panel.style.top = `${Math.min(Math.max(0, e.clientY - dy), maxY)}px`;
    };
    const up = () => {
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      document.removeEventListener('lostpointercapture', up);
    };
    document.body.style.userSelect = 'none';
    // Capture so a release outside the viewport still ends the drag.
    pointer.target?.setPointerCapture(pointer.id);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    document.addEventListener('lostpointercapture', up);
    move({ clientX: pointer.x, clientY: pointer.y });
  };

  const blur = async () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && opts.panel()?.contains(active)) active.blur();
  };

  return {
    fs: {
      read: async (name: FileName) => files.get(name) ?? null,
      write: async (name: FileName, text: string) => {
        files.set(name, text);
        const set = watchers.get(name);
        if (set) {
          for (const cb of Array.from(set)) {
            cb();
          }
        }
      },
      watch: async (name: FileName, onChange: () => void) => {
        let set = watchers.get(name);
        if (!set) {
          set = new Set();
          watchers.set(name, set);
        }
        set.add(onChange);
        return () => {
          set?.delete(onChange);
        };
      },
      describe: async (_name: FileName) => 'In memory. Reload to reset.',
      reveal: async (_name: FileName) => {},
    },
    clipboard: {
      write: async (text: string) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
        }
      },
    },
    window: {
      show: async ({ focus }) => {
        opts.onShow(focus);
      },
      hide: blur,
      close: blur,
      quit: blur,
      startDragging,
      onFocusChanged: async (handler: (focused: boolean) => void) => {
        const check = () => handler(Boolean(opts.panel()?.contains(document.activeElement)));
        document.addEventListener('focusin', check);
        document.addEventListener('focusout', check);
        check();
        return () => {
          document.removeEventListener('focusin', check);
          document.removeEventListener('focusout', check);
        };
      },
      setZoom: async () => {},
      setTheme: async () => {},
    },
    permissions: {
      status: async () => ({ trusted: true, inputMonitoring: true }),
      onChange: async () => () => {},
      request: async () => {},
    },
    updates: {
      check: async () => null,
      install: async () => {
        throw new Error('No updates on the web');
      },
    },
    settings: {
      open: async () => {
        throw new Error('No settings window on the web');
      },
    },
    onGesture: async (handler: (g: GestureInput) => void) => {
      let lastShiftDown = 0;

      const fire = () => {
        const panel = opts.panel();
        const focused = Boolean(panel?.contains(document.activeElement));
        const sel = getSelection();
        const raw = sel?.toString().trim() ?? '';
        const outside = Boolean(raw && !panel?.contains(sel?.anchorNode ?? null));
        if (outside) sel?.removeAllRanges();
        handler({ focused, selection: outside ? raw : null });
      };

      // Press edges, like the native detector. An installed JogPad fires on the
      // second press and pulls focus to its panel, and Chrome drops the keyup
      // for a window that lost focus mid-press, so counting keyups never saw
      // the second tap when the app was running.
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Shift') {
          lastShiftDown = 0;
          return;
        }
        if (e.repeat) return;
        if (performance.now() - lastShiftDown < 400) {
          lastShiftDown = 0;
          fire();
        } else {
          lastShiftDown = performance.now();
        }
      };

      window.addEventListener('keydown', onKeyDown);
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('pointerdown', onPointerDown, true);
      };
    },
  };
}
