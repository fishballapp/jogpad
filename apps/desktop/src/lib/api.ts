import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type Item = { id: number; text: string; done: boolean };
export type Page = { name: string; items: Item[] };
export type UpdateChannel = 'stable' | 'beta';
export type Theme = 'dark' | 'light' | 'system';
export type UpdateInfo = { version: string; notes: string | null };

export type Snapshot = {
  /// Increases with every snapshot. Rust emits them from commands, the hotkey
  /// thread and the permission poller, so they can arrive out of order.
  rev: number;
  pages: Page[];
  active: string;
  zoom: number;
  update_channel: UpdateChannel;
  theme: Theme;
  check_on_copy: boolean;
  group_done: boolean;
  notes_path: string;
  /// The notes file could not be read, so nothing is being written to it.
  read_only: boolean;
  error: string | null;
  trusted: boolean;
  input_monitoring: boolean;
};

export const api = {
  snapshot: () => invoke<Snapshot>('snapshot'),
  addItem: (text: string, page?: string) => invoke<void>('add_item', { text, page: page ?? null }),
  updateItem: (id: number, text: string) => invoke<void>('update_item', { id, text }),
  toggleItem: (id: number) => invoke<void>('toggle_item', { id }),
  setDone: (ids: number[], done: boolean) => invoke<void>('set_done', { ids, done }),
  deleteItems: (ids: number[]) => invoke<void>('delete_items', { ids }),
  moveItemsBefore: (ids: number[], before: number | null, page: string) =>
    invoke<void>('move_items_before', { ids, before, page }),
  moveItems: (ids: number[], page: string) => invoke<void>('move_items', { ids, page }),
  mergeItems: (ids: number[]) => invoke<void>('merge_items', { ids }),
  setActive: (page: string) => invoke<void>('set_active', { page }),
  renamePage: (from: string, to: string) => invoke<void>('rename_page', { from, to }),
  deletePage: (page: string) => invoke<void>('delete_page', { page }),
  copyAsList: (ids: number[]) => invoke<string>('copy_as_list', { ids }),
  toggleWindow: () => invoke<void>('toggle_window'),
  requestPermissions: () => invoke<void>('request_permissions'),
  revealNotes: () => invoke<void>('reveal_notes'),
  hideWindow: () => invoke<void>('hide_window'),
  openSettings: () => invoke<void>('open_settings'),
  quit: () => invoke<void>('quit'),
  setZoom: (zoom: number) => invoke<void>('set_zoom', { zoom }),
  setUpdateChannel: (channel: UpdateChannel) => invoke<void>('set_update_channel', { channel }),
  setTheme: (theme: Theme) => invoke<void>('set_theme', { theme }),
  setCheckOnCopy: (value: boolean) => invoke<void>('set_check_on_copy', { value }),
  setGroupDone: (value: boolean) => invoke<void>('set_group_done', { value }),
  checkUpdate: () => invoke<UpdateInfo | null>('check_update'),
  installUpdate: () => invoke<void>('install_update'),
};

// ponytail: running `pnpm vite` on its own opens the UI in a browser with
// fixture data, so front-end work does not need a Rust rebuild. Drop this
// block if the app ever gets a real dev harness.
export const inTauri = '__TAURI_INTERNALS__' in window;

// Tauri's `listen` reaches for internals the browser does not have, and it
// runs before the first snapshot, so leaving it unstubbed failed the whole
// screen rather than one event.
export const on: typeof listen = inTauri ? listen : ((async () => () => {}) as typeof listen);

if (!inTauri) {
  const fixture: Snapshot = {
    rev: 0,
    active: 'Inbox',
    zoom: 1,
    update_channel: 'stable',
    theme: 'dark',
    check_on_copy: true,
    group_done: true,
    read_only: false,
    error: null,
    notes_path: '~/Library/Application Support/com.ycmjason.jogpad/notes.md',
    trusted: false,
    input_monitoring: false,
    pages: [
      {
        name: 'Inbox',
        items: [
          { id: 1, text: 'https://github.com/ahkohd/tauri-nspanel', done: false },
          {
            id: 2,
            text: 'A listen-only event tap cannot swallow keystrokes, which matters\nbecause swallowing Shift would break every capital letter.',
            done: false,
          },
          { id: 3, text: 'Ask about the retry backoff in sync.ts', done: true },
        ],
      },
      { name: 'Refactor', items: [{ id: 4, text: 'Split the store module', done: false }] },
    ],
  };
  // Every method, not just the ones the first screen needs: a half-stubbed
  // api throws as soon as you click a row, which defeats the point.
  Object.assign(api, {
    snapshot: async () => fixture,
    addItem: async () => {},
    updateItem: async () => {},
    toggleItem: async () => {},
    setDone: async () => {},
    deleteItems: async () => {},
    moveItemsBefore: async () => {},
    moveItems: async () => {},
    mergeItems: async () => {},
    setActive: async () => {},
    renamePage: async () => {},
    deletePage: async () => {},
    copyAsList: async () => '',
    requestPermissions: async () => {},
    revealNotes: async () => {},
    hideWindow: async () => {},
    openSettings: async () => {},
    quit: async () => {},
    toggleWindow: async () => {},
    setZoom: async () => {},
    setUpdateChannel: async () => {},
    setTheme: async () => {},
    setCheckOnCopy: async () => {},
    setGroupDone: async () => {},
    checkUpdate: async () => null,
    installUpdate: async () => {},
  });
}
