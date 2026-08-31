import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Item = { id: number; text: string; done: boolean };
export type Section = { name: string; items: Item[] };
export type UpdateChannel = "stable" | "beta";
export type UpdateInfo = { version: string; notes: string | null };

export type Snapshot = {
  /// Increases with every snapshot. Rust emits them from commands, the hotkey
  /// thread and the permission poller, so they can arrive out of order.
  rev: number;
  sections: Section[];
  active: string;
  zoom: number;
  update_channel: UpdateChannel;
  notes_path: string;
  /// The notes file could not be read, so nothing is being written to it.
  read_only: boolean;
  error: string | null;
  trusted: boolean;
  input_monitoring: boolean;
};

export const api = {
  snapshot: () => invoke<Snapshot>("snapshot"),
  addItem: (text: string, section?: string) =>
    invoke<void>("add_item", { text, section: section ?? null }),
  updateItem: (id: number, text: string) => invoke<void>("update_item", { id, text }),
  toggleItem: (id: number) => invoke<void>("toggle_item", { id }),
  deleteItems: (ids: number[]) => invoke<void>("delete_items", { ids }),
  moveItems: (ids: number[], section: string) =>
    invoke<void>("move_items", { ids, section }),
  mergeItems: (ids: number[]) => invoke<void>("merge_items", { ids }),
  setActive: (section: string) => invoke<void>("set_active", { section }),
  renameSection: (from: string, to: string) =>
    invoke<void>("rename_section", { from, to }),
  deleteSection: (section: string) => invoke<void>("delete_section", { section }),
  copyAsList: (ids: number[]) => invoke<string>("copy_as_list", { ids }),
  toggleWindow: () => invoke<void>("toggle_window"),
  requestPermissions: () => invoke<void>("request_permissions"),
  revealNotes: () => invoke<void>("reveal_notes"),
  hideWindow: () => invoke<void>("hide_window"),
  quit: () => invoke<void>("quit"),
  setZoom: (zoom: number) => invoke<void>("set_zoom", { zoom }),
  setUpdateChannel: (channel: UpdateChannel) =>
    invoke<void>("set_update_channel", { channel }),
  checkUpdate: () => invoke<UpdateInfo | null>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
};

// ponytail: running `pnpm vite` on its own opens the UI in a browser with
// fixture data, so front-end work does not need a Rust rebuild. Drop this
// block if the app ever gets a real dev harness.
export const inTauri = "__TAURI_INTERNALS__" in window;

// Tauri's `listen` reaches for internals the browser does not have, and it
// runs before the first snapshot, so leaving it unstubbed failed the whole
// screen rather than one event.
export const on: typeof listen = inTauri
  ? listen
  : ((async () => () => {}) as typeof listen);

if (!inTauri) {
  const fixture: Snapshot = {
    rev: 0,
    active: "Inbox",
    zoom: 1,
    update_channel: "stable",
    read_only: false,
    error: null,
    notes_path: "~/Library/Application Support/com.ycmjason.jogpad/notes.md",
    trusted: false,
    input_monitoring: false,
    sections: [
      {
        name: "Inbox",
        items: [
          { id: 1, text: "https://github.com/ahkohd/tauri-nspanel", done: false },
          {
            id: 2,
            text: "A listen-only event tap cannot swallow keystrokes, which matters\nbecause swallowing Shift would break every capital letter.",
            done: false,
          },
          { id: 3, text: "Ask about the retry backoff in sync.ts", done: true },
        ],
      },
      { name: "Refactor", items: [{ id: 4, text: "Split the store module", done: false }] },
    ],
  };
  // Every method, not just the ones the first screen needs: a half-stubbed
  // api throws as soon as you click a row, which defeats the point.
  Object.assign(api, {
    snapshot: async () => fixture,
    addItem: async () => {},
    updateItem: async () => {},
    toggleItem: async () => {},
    deleteItems: async () => {},
    moveItems: async () => {},
    mergeItems: async () => {},
    setActive: async () => {},
    renameSection: async () => {},
    deleteSection: async () => {},
    copyAsList: async () => "",
    requestPermissions: async () => {},
    revealNotes: async () => {},
    hideWindow: async () => {},
    quit: async () => {},
    toggleWindow: async () => {},
    setZoom: async () => {},
    setUpdateChannel: async () => {},
    checkUpdate: async () => null,
    installUpdate: async () => {},
  });
}
