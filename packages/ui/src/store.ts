import type { FileName, Host, Unlisten } from './host.ts';
import {
  type Attachment,
  DEFAULT_PAGE,
  type Doc,
  docRefs,
  type Item,
  Model,
  type Page,
  parseDoc,
  parsePrefs,
  serialiseDoc,
  type Theme,
  type UpdateChannel,
} from './model.ts';

export type { Attachment, Item, Page, Theme, UpdateChannel };

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
      // What someone else removed is theirs to clean up. Forgetting it here
      // means the next save cannot mistake it for something we dropped.
      store.saved = docRefs(store.model.doc);
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
  private writing: Partial<Record<FileName, string>> = {};
  private written: Partial<Record<FileName, string>> = {};
  private listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();
  /// The attachment refs in the document as last written. A file exists on
  /// disk exactly when something here references it; every notes write
  /// settles the difference, so no mutation can forget to.
  saved: Set<string>;

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
    this.saved = docRefs(model.doc);
  }

  snapshot(): Snapshot {
    return {
      pages: this.model.doc.pages.map(p => ({ ...p, items: p.items.map(i => ({ ...i })) })),
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
    if (text !== null && (text === this.writing[name] || text === this.written[name])) return true;
    // A different writer may later restore one of our old values. Only the
    // current write and its latest successful predecessor can be echoes.
    delete this.written[name];
    return false;
  }

  /// Resolves once this write has landed, after every write queued before
  /// it: true if it reached the disk, false if it did not and the error is
  /// now on the snapshot.
  private write(name: FileName, text: string): Promise<boolean> {
    const turn = this.queue.then(async () => {
      // Register when the write starts, not when queued: a long burst must
      // not forget the write that is still landing on disk.
      this.writing[name] = text;
      try {
        await this.host.fs.write(name, text);
        this.written[name] = text;
        return true;
      } catch (e) {
        const desc = await this.host.fs.describe(name);
        this.error = `Could not write ${desc}: ${e}`;
        this.emit('notes', this.snapshot());
        return false;
      } finally {
        delete this.writing[name];
      }
    });
    this.queue = turn.then(() => {});
    return turn;
  }

  /// The UI sees the change at once; the disk catches up in order.
  async saveNotes(): Promise<void> {
    this.emit('notes', this.snapshot());
    await this.writeNotes();
  }

  /// The one way notes reach the disk. After the write lands, any file the
  /// document no longer mentions goes; a failure there is left alone, since
  /// the notes are safe and an unreferenced file is only clutter.
  private async writeNotes(): Promise<void> {
    if (this.readOnly) return;
    // Match the serialized document, not mutations made while its write waits.
    const now = docRefs(this.model.doc);
    // Only a write that landed may take files away: the notes on disk still
    // mention them until then, and a full disk is not a reason to lose them.
    if (!(await this.write('notes.md', serialiseDoc(this.model.doc)))) return;
    const gone = [...this.saved].filter(ref => !now.has(ref));
    this.saved = now;
    for (const ref of gone) {
      try {
        await this.host.attachments.remove(ref);
      } catch {
        // Left where it is.
      }
    }
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
    await this.writeNotes();
  }

  /// Files are written first, so the refs the item carries are real by the
  /// time notes.md mentions them.
  async addItem(text: string, page = this.model.prefs.active, files: File[] = []): Promise<void> {
    const attachments = await this.storeFiles(files);
    if (this.model.addItem(text, page, attachments) !== null) await this.saveNotes();
  }

  async attach(id: number, files: File[]): Promise<void> {
    const attachments = await this.storeFiles(files);
    if (this.model.attach(id, attachments)) await this.saveNotes();
  }

  private async storeFiles(files: File[]): Promise<Attachment[]> {
    if (files.length === 0) return [];
    // A file written now would never be referenced by a notes file that
    // cannot be written, and nothing would ever clean it up.
    if (this.readOnly) throw new Error('Nothing is being saved, so nothing can be attached.');
    const out: Attachment[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The name becomes a markdown link label, which cannot hold brackets
      // or line breaks. A display name is all it is, so drop them.
      const name =
        file.name.replace(/[[\]\r\n]/g, '').trim() || `pasted.${file.type.split('/')[1] ?? 'bin'}`;
      out.push({ name, ref: await this.host.attachments.put(bytes, name) });
    }
    return out;
  }

  async detach(id: number, ref: string): Promise<void> {
    if (this.model.detach(id, ref)) await this.saveNotes();
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
    const pageCount = this.model.doc.pages.length;
    if (!this.model.setActive(page)) return;
    // Creating a page changes the document even before it has any items.
    if (this.model.doc.pages.length !== pageCount) await this.saveNotes();
    await this.savePrefs();
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
    // Paths are resolved up front: the model is synchronous and the copy
    // must carry paths the reader can open, not refs into our folder.
    const paths = new Map<string, string>();
    for (const ref of this.model.attachmentRefs(ids)) {
      paths.set(ref, await this.host.attachments.path(ref));
    }
    const text = this.model.listText(ids, ref => paths.get(ref) ?? ref);
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
