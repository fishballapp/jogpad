import type { Attachment, Theme, UpdateChannel } from './model.ts';

export type FileName = 'notes.md' | 'prefs.json';
export type Unlisten = () => void;
export type UpdateInfo = { version: string; notes: string | null };
export type GestureInput = { focused: boolean; selection: string | null };
export type Permissions = { trusted: boolean; inputMonitoring: boolean };
/// `attachments/<hash>.<ext>`, the path an item writes into notes.md.
export type AttachmentRef = string;

export interface Host {
  fs: {
    /// null when the file does not exist. Throws when it exists and cannot
    /// be read; the store then goes read-only rather than overwrite it.
    read(name: FileName): Promise<string | null>;
    write(name: FileName, text: string): Promise<void>;
    /// Fires after any write to the file, from any window.
    watch(name: FileName, onChange: () => void): Promise<Unlisten>;
    /// A path for display.
    describe(name: FileName): Promise<string>;
    reveal(name: FileName): Promise<void>;
  };
  clipboard: { write(text: string): Promise<void> };
  attachments: {
    /// Keep the bytes and hand back the ref to write into the item. The same
    /// bytes give the same ref, so a screenshot pasted twice is one file.
    put(bytes: Uint8Array, name: string): Promise<AttachmentRef>;
    /// Something an <img> or <video> can load. Synchronous: rows render from it.
    url(ref: AttachmentRef): string;
    /// The path someone outside this app can open. Goes into copied text.
    path(ref: AttachmentRef): Promise<string>;
    reveal(ref: AttachmentRef): Promise<void>;
    /// Put the picture itself on the clipboard, for pasting into a chat box.
    copyImage(ref: AttachmentRef): Promise<void>;
    /// Take a file away for good, or as near as the platform allows: the
    /// desktop moves it to the Trash. Called once nothing references it.
    remove(ref: AttachmentRef): Promise<void>;
    /// Show one attachment large, outside the pad: the desktop opens a window
    /// over the whole screen, the web opens a tab.
    preview(attachment: Attachment): Promise<void>;
  };
  window: {
    /// Bring the panel up. With `focus`, take the keyboard and ask the UI to
    /// focus its composer (the `focus-input` event). Without it, the panel is
    /// ordered in front but whatever had the keyboard keeps it.
    show(opts: { focus: boolean }): Promise<void>;
    /// Put the panel away. Notes are kept.
    hide(): Promise<void>;
    /// Hide the window this UI is rendered in. Differs from `hide` only for the
    /// settings window, which is its own window on the desktop.
    close(): Promise<void>;
    quit(): Promise<void>;
    /// Called on pointer-down in the panel header, outside any control.
    startDragging(): void;
    /// Whether keystrokes currently land in the panel. The desktop panel has no
    /// title bar, so the UI draws the answer as its border.
    onFocusChanged(handler: (focused: boolean) => void): Promise<Unlisten>;
    setZoom(zoom: number): Promise<void>;
    setTheme(theme: Theme): Promise<void>;
  };
  permissions: {
    status(): Promise<Permissions>;
    onChange(handler: (p: Permissions) => void): Promise<Unlisten>;
    request(): Promise<void>;
  };
  updates: {
    /// The version this build is, as the updater compares it.
    version(): Promise<string>;
    check(channel: UpdateChannel): Promise<UpdateInfo | null>;
    install(channel: UpdateChannel): Promise<void>;
  };
  settings: { open(): Promise<void> };
  onGesture(handler: (g: GestureInput) => void): Promise<Unlisten>;
}
