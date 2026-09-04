import type { FileName, Host, Unlisten } from './host.ts';
import {
  DEFAULT_PAGE,
  type Doc,
  type Item,
  Model,
  type Page,
  parseDoc,
  parsePrefs,
  serialiseDoc,
  type Theme,
  type UpdateChannel,
} from './model.ts';

export type { Item, Page, Theme, UpdateChannel };

export type Snapshot = {
  pages: Page[];
  active: string;
  zoom: number;
  update_channel: UpdateChannel;
  theme: Theme;
  check_on_copy: boolean;
  group_done: boolean;
  /// The notes file could not be read, so nothing is being written to it.
  read_only: boolean;
  error: string | null;
};

export type Events = {
  notes: Snapshot;
  captured: number;
  'focus-input': undefined;
};

export async function createStore(host: Host): Promise<Store> {
  let prefsRaw: string | null = null;
  try {
    prefsRaw = await host.fs.read('prefs.json');
  } catch {
    // Falls back to default prefs below.
  }
  const { prefs, extra } = parsePrefs(prefsRaw);

  let notesRaw: string | null = null;
  let readOnly = false;
  let error: string | null = null;
  try {
    notesRaw = await host.fs.read('notes.md');
  } catch (e) {
    readOnly = true;
    const desc = await host.fs.describe('notes.md');
    error = `Could not read ${desc}: ${e}`;
  }

  const doc: Doc = parseDoc(notesRaw ?? '');
  if (!doc.pages.some(p => p.name === prefs.active)) {
    prefs.active = doc.pages[0]?.name ?? DEFAULT_PAGE;
  }

  const store = new Store(host, new Model(doc, prefs), extra, readOnly, error);

  // A missing file is an empty document, written once so "reveal" has a
  // target. An existing file is never rewritten on launch: the parser drops
  // markdown it does not model.
  if (notesRaw === null && !readOnly) await store.saveNotes();

  // Another window (settings on the desktop) has its own store and writes
  // the same files. Re-read what it changed, but not our own writes coming
  // back: re-parsing notes assigns fresh item ids and would drop the
  // selection.
  await host.fs.watch('prefs.json', async () => {
    try {
      const text = await host.fs.read('prefs.json');
      if (store.wroteRecently('prefs.json', text)) return;
      const parsed = parsePrefs(text);
      store.model.prefs = parsed.prefs;
      store.extra = parsed.extra;
      store.emit('notes', store.snapshot());
    } catch {
      // A failed re-read leaves the last good state on screen.
    }
  });

  await host.fs.watch('notes.md', async () => {
    try {
      const text = await host.fs.read('notes.md');
      if (store.wroteRecently('notes.md', text)) return;
      store.model.doc = parseDoc(text ?? '');
      if (!store.model.doc.pages.some(p => p.name === store.model.prefs.active)) {
        store.model.prefs.active = store.model.doc.pages[0]?.name ?? DEFAULT_PAGE;
      }
      store.emit('notes', store.snapshot());
    } catch {
      // A failed re-read leaves the last good state on screen.
    }
  });

  return store;
}

/// How many of this store's own writes to remember per file. Change events
/// can lag several writes behind under a burst of edits; the ones that
/// matter are always the newest.
const REMEMBERED_WRITES = 16;

export class Store {
  private host: Host;
  model: Model;
  extra: Record<string, unknown>;
  private readOnly: boolean;
  private error: string | null;
  /// Writes are serialised: the UI fires mutations without awaiting them,
  /// and two overlapping writes could otherwise land out of order and leave
  /// an older document on disk.
  private queue: Promise<void> = Promise.resolve();
  private recent: Record<FileName, string[]> = { 'notes.md': [], 'prefs.json': [] };
  private listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();

  constructor(
    host: Host,
    model: Model,
    extra: Record<string, unknown>,
    readOnly: boolean,
    error: string | null,
  ) {
    this.host = host;
    this.model = model;
    this.extra = extra;
    this.readOnly = readOnly;
    this.error = error;
  }

  snapshot(): Snapshot {
    return {
      pages: this.model.doc.pages,
      active: this.model.prefs.active,
      zoom: this.model.prefs.zoom,
      update_channel: this.model.prefs.update_channel,
      theme: this.model.prefs.theme,
      check_on_copy: this.model.prefs.check_on_copy,
      group_done: this.model.prefs.group_done,
      read_only: this.readOnly,
      error: this.error,
    };
  }

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unlisten {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const listener = handler as (payload: unknown) => void;
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of Array.from(set)) {
        fn(payload);
      }
    }
  }

  wroteRecently(name: FileName, text: string | null): boolean {
    return text !== null && this.recent[name].includes(text);
  }

  /// Resolves once this write has landed, after every write queued before it.
  private write(name: FileName, text: string): Promise<void> {
    const recent = this.recent[name];
    recent.push(text);
    if (recent.length > REMEMBERED_WRITES) recent.shift();
    const turn = this.queue.then(async () => {
      try {
        await this.host.fs.write(name, text);
      } catch (e) {
        const desc = await this.host.fs.describe(name);
        this.error = `Could not write ${desc}: ${e}`;
        this.emit('notes', this.snapshot());
      }
    });
    this.queue = turn;
    return turn;
  }

  /// The UI sees the change at once; the disk catches up in order.
  async saveNotes(): Promise<void> {
    this.emit('notes', this.snapshot());
    if (this.readOnly) return;
    await this.write('notes.md', serialiseDoc(this.model.doc));
  }

  private async savePrefs(): Promise<void> {
    this.emit('notes', this.snapshot());
    await this.write('prefs.json', JSON.stringify({ ...this.extra, ...this.model.prefs }, null, 2));
  }

  async capture(text: string): Promise<void> {
    const id = this.model.addItem(text);
    if (id === null) return;
    // After the snapshot, or the UI would select an item it has not been
    // told about yet and drop the selection as stale.
    this.emit('notes', this.snapshot());
    this.emit('captured', id);
    if (!this.readOnly) await this.write('notes.md', serialiseDoc(this.model.doc));
  }

  async addItem(text: string, page?: string): Promise<void> {
    if (this.model.addItem(text, page) !== null) await this.saveNotes();
  }

  async updateItem(id: number, text: string): Promise<void> {
    if (this.model.updateItem(id, text)) await this.saveNotes();
  }

  async toggleItem(id: number): Promise<void> {
    if (this.model.toggleItem(id)) await this.saveNotes();
  }

  async setDone(ids: number[], done: boolean): Promise<void> {
    if (this.model.setDone(ids, done)) await this.saveNotes();
  }

  async deleteItems(ids: number[]): Promise<void> {
    if (this.model.deleteItems(ids)) await this.saveNotes();
  }

  async moveItemsBefore(ids: number[], before: number | null, page: string): Promise<void> {
    if (this.model.moveItemsBefore(ids, before, page)) await this.saveNotes();
  }

  async moveItems(ids: number[], page: string): Promise<void> {
    if (this.model.moveItems(ids, page)) await this.saveNotes();
  }

  async mergeItems(ids: number[]): Promise<void> {
    if (this.model.mergeItems(ids)) await this.saveNotes();
  }

  async setActive(page: string): Promise<void> {
    if (this.model.setActive(page)) await this.savePrefs();
  }

  async renamePage(from: string, to: string): Promise<void> {
    const prevActive = this.model.prefs.active;
    if (!this.model.renamePage(from, to)) return;
    // The active page moved with the rename, so prefs change too.
    if (this.model.prefs.active !== prevActive) await this.savePrefs();
    await this.saveNotes();
  }

  async deletePage(page: string): Promise<void> {
    if (!this.model.deletePage(page)) return;
    await this.savePrefs();
    await this.saveNotes();
  }

  async copyAsList(ids: number[]): Promise<string> {
    const text = this.model.listText(ids);
    await this.host.clipboard.write(text);
    // Only after the clipboard write: checking off something that never made
    // it to the clipboard would lose it twice over.
    if (this.model.checkOff(ids)) await this.saveNotes();
    return text;
  }

  async setZoom(zoom: number): Promise<void> {
    this.model.setZoom(zoom);
    await this.host.window.setZoom(this.model.prefs.zoom);
    await this.savePrefs();
  }

  async setUpdateChannel(channel: UpdateChannel): Promise<void> {
    if (this.model.setUpdateChannel(channel)) await this.savePrefs();
  }

  async setTheme(theme: Theme): Promise<void> {
    this.model.setTheme(theme);
    await this.host.window.setTheme(this.model.prefs.theme);
    await this.savePrefs();
  }

  async setCheckOnCopy(value: boolean): Promise<void> {
    this.model.setCheckOnCopy(value);
    await this.savePrefs();
  }

  async setGroupDone(value: boolean): Promise<void> {
    this.model.setGroupDone(value);
    await this.savePrefs();
  }
}
