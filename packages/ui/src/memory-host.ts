import type { Host } from './host.ts';
import { createMemoryAttachments } from './memory-attachments.ts';

/// A host that lives in a Map: the site's demo and the desktop's browser dev
/// host. Writes fire the watchers like the desktop's fs does. The window,
/// permissions and updates are inert; a host that has a window to show
/// spreads over the parts it can do.
export function createMemoryHost(notes: string): Host {
  const files = new Map<string, string>([['notes.md', notes]]);
  const watchers = new Map<string, Set<() => void>>();
  return {
    fs: {
      read: async name => files.get(name) ?? null,
      write: async (name, text) => {
        files.set(name, text);
        for (const cb of Array.from(watchers.get(name) ?? [])) cb();
      },
      watch: async (name, onChange) => {
        const set = watchers.get(name) ?? new Set();
        watchers.set(name, set);
        set.add(onChange);
        return () => {
          set.delete(onChange);
        };
      },
      describe: async () => 'In memory. Reload to reset.',
      reveal: async () => {},
    },
    clipboard: {
      write: async text => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
        }
      },
    },
    attachments: createMemoryAttachments(),
    window: {
      show: async () => {},
      hide: async () => {},
      activate: async () => {},
      close: async () => {},
      quit: async () => {},
      startDragging: () => {},
      onFocusChanged: async () => () => {},
      setZoom: async () => {},
      setTheme: async () => {},
    },
    permissions: {
      status: async () => ({ trusted: true, inputMonitoring: true }),
      onChange: async () => () => {},
      request: async () => {},
    },
    updates: {
      version: async () => 'in-memory',
      check: async () => null,
      install: async () => {
        throw new Error('No updates in memory.');
      },
    },
    settings: {
      open: async () => {
        throw new Error('No settings window in memory.');
      },
    },
    onGesture: async () => () => {},
  };
}
