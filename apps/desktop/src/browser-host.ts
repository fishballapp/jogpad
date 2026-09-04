import type { FileName, Host } from '@jogpad/ui';

const demoMarkdown = `## Inbox

- [ ] https://github.com/ahkohd/tauri-nspanel
- [ ] A listen-only event tap cannot swallow keystrokes, which matters
  because swallowing Shift would break every capital letter.
- [x] Ask about the retry backoff in sync.ts

## Refactor

- [ ] Split the store module
`;

const files = new Map<FileName, string>([['notes.md', demoMarkdown]]);
const watchers = new Map<FileName, Set<() => void>>();

export const browserHost: Host = {
  fs: {
    read: async name => files.get(name) ?? null,
    write: async (name, text) => {
      files.set(name, text);
      const set = watchers.get(name);
      if (set) {
        for (const cb of Array.from(set)) cb();
      }
    },
    watch: async (name, onChange) => {
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
  window: {
    show: async () => {},
    hide: async () => {},
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
    check: async () => null,
    install: async () => {
      throw new Error('No updates in browser');
    },
  },
  settings: {
    open: async () => {
      throw new Error('No settings window in browser');
    },
  },
  onGesture: async () => () => {},
};
