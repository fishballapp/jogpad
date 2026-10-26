export type Item = { id: number; text: string; isDone: boolean };
export type Page = { name: string; items: Item[] };
export type Doc = { pages: Page[] };
export const DEFAULT_PAGE = 'Inbox';

/**
 * A file kept beside notes.md. `ref` is the path as written in the file,
 * `attachments/<hash>.<ext>`; `name` is what the user called it.
 */
export type Attachment = { name: string; ref: string };

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
export const isImage = (name: string) => IMAGE_EXTS.has(extensionOf(name));
export const isVideo = (name: string) => VIDEO_EXTS.has(extensionOf(name));

// Attachments lead an item's text, one markdown link per line, images with
// the `!`. They sit inside the item text so the parser stays the same and an
// older build shows them as words rather than losing them.
const ATTACHMENT_LINE = /^!?\[([^\]]*)\]\((attachments\/[^\s)]+)\)$/;

export function splitItem(text: string): { attachments: Attachment[]; body: string } {
  const lines = text.split('\n');
  const attachments: Attachment[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = ATTACHMENT_LINE.exec(lines[i] ?? '');
    if (!m) break;
    attachments.push({ name: m[1] || m[2]?.slice('attachments/'.length) || '', ref: m[2] ?? '' });
  }
  return { attachments, body: lines.slice(i).join('\n') };
}

export function joinItem(attachments: Attachment[], body: string): string {
  const lines = attachments.map(a => `${isImage(a.name) ? '!' : ''}[${a.name}](${a.ref})`);
  if (body) lines.push(body);
  return lines.join('\n');
}

/**
 * Every attachment ref the document mentions. What is on disk should be
 * exactly this set; the store keeps it so.
 */
export function docRefs({ pages }: Doc): Set<string> {
  return new Set(
    pages.flatMap(({ items }) =>
      items.flatMap(({ text }) => splitItem(text).attachments.map(a => a.ref)),
    ),
  );
}

/** Attachments count: a picture with nothing written under it is still an item. */
export const isBlankItem = (text: string) => text.trim() === '';

let nextId = 1;

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r?\n$/, '').split(/\r?\n/);
}

export function parseDoc(markdown: string): Doc {
  const pages: Page[] = [];
  let pendingBlanks = 0;

  for (const line of splitLines(markdown)) {
    if (line.startsWith('## ')) {
      pages.push({ name: line.slice(3).trim(), items: [] });
      pendingBlanks = 0;
      continue;
    }

    const bullet = (() => {
      if (line.startsWith('- [ ] ')) return { isDone: false, text: line.slice(6) };
      if (line.startsWith('- [x] ') || line.startsWith('- [X] ')) {
        return { isDone: true, text: line.slice(6) };
      }
      if (line.startsWith('- ')) return { isDone: false, text: line.slice(2) };
      return null;
    })();

    if (bullet) {
      const page =
        pages.at(-1) ??
        (() => {
          const inbox = { name: DEFAULT_PAGE, items: [] };
          pages.push(inbox);
          return inbox;
        })();
      page.items.push({ id: nextId++, ...bullet });
      pendingBlanks = 0;
      continue;
    }

    if (line.trim() === '') {
      pendingBlanks++;
      continue;
    }

    const lastItem = line.startsWith('  ') ? pages.at(-1)?.items.at(-1) : undefined;
    if (lastItem) {
      lastItem.text += `${'\n'.repeat(pendingBlanks + 1)}${line.slice(2)}`;
    }
    pendingBlanks = 0;
  }

  if (pages.length === 0) {
    pages.push({ name: DEFAULT_PAGE, items: [] });
  }

  return { pages };
}

export function serialiseDoc({ pages }: Doc): string {
  return pages
    .map(({ name, items }) => {
      const bullets = items.map(({ isDone, text }) => {
        const [first = '', ...rest] = text.split('\n');
        const continuation = rest.map(line => (line === '' ? '\n' : `\n  ${line}`)).join('');
        return `- [${isDone ? 'x' : ' '}] ${first}${continuation}\n`;
      });
      return `## ${name}\n\n${bullets.join('')}\n`;
    })
    .join('');
}

export function normalisePageName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes('\r')) {
    return null;
  }
  return trimmed;
}

export type UpdateChannel = 'stable' | 'beta' | 'dev';
export type Theme = 'dark' | 'light' | 'system';
export type Prefs = {
  active: string;
  zoom: number;
  update_channel: UpdateChannel;
  check_on_copy: boolean;
  group_done: boolean;
  theme: Theme;
};

export const defaultPrefs: Prefs = {
  active: DEFAULT_PAGE,
  zoom: 1,
  update_channel: 'stable',
  check_on_copy: true,
  group_done: true,
  theme: 'dark',
};

export function parsePrefs(json: string | null): {
  prefs: Prefs;
  extra: Record<string, unknown>;
} {
  const parsed: unknown = (() => {
    if (json === null) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  })();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { prefs: { ...defaultPrefs }, extra: {} };
  }

  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
  const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => !(k in defaultPrefs)));
  const prefs: Prefs = {
    active: typeof raw.active === 'string' ? raw.active : defaultPrefs.active,
    zoom: typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? raw.zoom : defaultPrefs.zoom,
    update_channel: isChannel(raw.update_channel)
      ? raw.update_channel
      : defaultPrefs.update_channel,
    check_on_copy:
      typeof raw.check_on_copy === 'boolean' ? raw.check_on_copy : defaultPrefs.check_on_copy,
    group_done: typeof raw.group_done === 'boolean' ? raw.group_done : defaultPrefs.group_done,
    theme: isTheme(raw.theme) ? raw.theme : defaultPrefs.theme,
  };
  return { prefs, extra };
}

const isChannel = (v: unknown): v is UpdateChannel => v === 'stable' || v === 'beta' || v === 'dev';
const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light' || v === 'system';

export class Model {
  doc: Doc;
  prefs: Prefs;

  constructor(doc: Doc, prefs: Prefs) {
    this.doc = doc;
    this.prefs = prefs;
  }

  private pageMut(name: string): Page {
    const existing = this.doc.pages.find(p => p.name === name);
    if (existing) return existing;
    const page = { name, items: [] };
    this.doc.pages.push(page);
    return page;
  }

  private itemMut(id: number): Item | undefined {
    return this.doc.pages.flatMap(p => p.items).find(i => i.id === id);
  }

  private takeItems(ids: number[]): Item[] {
    const idSet = new Set(ids);
    const taken = this.itemsInOrder(ids);
    for (const page of this.doc.pages) {
      page.items = page.items.filter(i => !idSet.has(i.id));
    }
    return taken;
  }

  private itemsInOrder(ids: number[]): Item[] {
    const idSet = new Set(ids);
    return this.doc.pages.flatMap(p => p.items).filter(i => idSet.has(i.id));
  }

  addItem(text: string, page?: string, attachments: Attachment[] = []): number | null {
    const trimmed = joinItem(attachments, text.trim());
    if (isBlankItem(trimmed)) return null;

    // A hand-edited file can hold a page whose name fails normalisation (a
    // blank heading). The note still has to land somewhere.
    const pageName = normalisePageName(page ?? this.prefs.active) ?? DEFAULT_PAGE;

    const id = nextId++;
    this.pageMut(pageName).items.push({
      id,
      text: trimmed,
      isDone: false,
    });
    return id;
  }

  /**
   * The editor only ever shows the body, so the item's attachments carry
   * over. An item left with no body and nothing attached is deleted.
   */
  updateItem(id: number, body: string): boolean {
    const item = this.itemMut(id);
    if (!item) return false;
    const text = joinItem(splitItem(item.text).attachments, body.trim() === '' ? '' : body);
    if (isBlankItem(text)) {
      return this.takeItems([id]).length > 0;
    }
    item.text = text;
    return true;
  }

  attach(id: number, added: Attachment[]): boolean {
    const item = this.itemMut(id);
    if (!item || added.length === 0) return false;
    const { attachments, body } = splitItem(item.text);
    const seen = new Set(attachments.map(a => a.ref));
    for (const a of added) {
      if (!seen.has(a.ref)) {
        seen.add(a.ref);
        attachments.push(a);
      }
    }
    item.text = joinItem(attachments, body);
    return true;
  }

  detach(id: number, ref: string): boolean {
    const item = this.itemMut(id);
    if (!item) return false;
    const { attachments, body } = splitItem(item.text);
    const kept = attachments.filter(a => a.ref !== ref);
    if (kept.length === attachments.length) return false;
    const text = joinItem(kept, body);
    if (isBlankItem(text)) return this.takeItems([id]).length > 0;
    item.text = text;
    return true;
  }

  toggleItem(id: number): boolean {
    const item = this.itemMut(id);
    if (!item) return false;
    item.isDone = !item.isDone;
    return true;
  }

  setDone(ids: number[], isDone: boolean): boolean {
    let hasChanged = false;
    for (const id of ids) {
      const item = this.itemMut(id);
      if (item && item.isDone !== isDone) {
        item.isDone = isDone;
        hasChanged = true;
      }
    }
    return hasChanged;
  }

  deleteItems(ids: number[]): boolean {
    return this.takeItems(ids).length > 0;
  }

  moveItems(ids: number[], page: string): boolean {
    const norm = normalisePageName(page);
    if (!norm) return false;
    const moved = this.takeItems(ids);
    this.pageMut(norm).items.push(...moved);
    return true;
  }

  mergeItems(ids: number[]): boolean {
    const ordered = this.itemsInOrder(ids);
    const [first, ...others] = ordered;
    if (!first || others.length === 0) return false;
    // Attachments of every item lead the merged one, in order, without
    // repeats; the bodies follow.
    const parts = ordered.map(i => splitItem(i.text));
    const seen = new Set<string>();
    const attachments = parts
      .flatMap(p => p.attachments)
      .filter(a => {
        if (seen.has(a.ref)) return false;
        seen.add(a.ref);
        return true;
      });
    const text = joinItem(
      attachments,
      parts
        .map(p => p.body)
        .filter(Boolean)
        .join('\n\n'),
    );
    this.takeItems(others.map(i => i.id));
    first.text = text;
    return true;
  }

  setActive(page: string): boolean {
    const norm = normalisePageName(page);
    if (!norm) return false;
    this.pageMut(norm);
    this.prefs.active = norm;
    return true;
  }

  renamePage(from: string, to: string): boolean {
    const normTo = normalisePageName(to);
    if (!normTo) return false;
    if (this.doc.pages.some(s => s.name === normTo)) return false;
    const page = this.doc.pages.find(s => s.name === from);
    if (!page) return false;
    page.name = normTo;
    if (this.prefs.active === from) {
      this.prefs.active = normTo;
    }
    return true;
  }

  deletePage(page: string): boolean {
    const index = this.doc.pages.findIndex(s => s.name === page);
    if (index < 0) return false;
    this.doc.pages.splice(index, 1);
    if (this.doc.pages.length === 0) {
      this.pageMut(DEFAULT_PAGE);
    }
    if (this.prefs.active === page) {
      // The page that took its place, or the one before it when it was last.
      const next = this.doc.pages[index] ?? this.doc.pages[index - 1];
      this.prefs.active = next?.name ?? DEFAULT_PAGE;
    }
    return true;
  }

  movePageBefore(name: string, before: string | null): boolean {
    const from = this.doc.pages.findIndex(p => p.name === name);
    if (from < 0 || name === before) return false;
    const [page] = this.doc.pages.splice(from, 1);
    if (!page) return false;
    const to = before === null ? -1 : this.doc.pages.findIndex(p => p.name === before);
    if (to < 0) {
      this.doc.pages.push(page);
    } else {
      this.doc.pages.splice(to, 0, page);
    }
    return true;
  }

  moveItemsBefore(ids: number[], before: number | null, page: string): boolean {
    const normPage = normalisePageName(page);
    if (!normPage) return false;

    const layout = (pages: Page[]) => pages.map(p => p.items.map(i => i.id));
    const original = layout(this.doc.pages);

    const taken = this.takeItems(ids);
    if (taken.length === 0) return false;

    const homePage =
      before === null ? undefined : this.doc.pages.find(p => p.items.some(i => i.id === before));
    const targetPage = homePage ?? this.pageMut(normPage);

    const beforeIndex = before === null ? -1 : targetPage.items.findIndex(i => i.id === before);
    targetPage.items.splice(beforeIndex < 0 ? targetPage.items.length : beforeIndex, 0, ...taken);

    return JSON.stringify(original) !== JSON.stringify(layout(this.doc.pages));
  }

  attachmentRefs(ids: number[]): string[] {
    return this.itemsInOrder(ids).flatMap(i => splitItem(i.text).attachments.map(a => a.ref));
  }

  /**
   * The copy is plain text. Attachments come first as paths the reader can
   * open, `pathOf` turning a ref into one that means something outside
   * this app.
   */
  listText(ids: number[], pathOf: (ref: string) => string = ref => ref): string {
    const items = this.itemsInOrder(ids);
    const render = (item: Item) => {
      const { attachments, body } = splitItem(item.text);
      const lines: string[] = [];
      if (attachments.length > 0) {
        // Backticks: the paths have spaces in them, and every reader of this
        // text speaks markdown.
        lines.push(`Attached: ${attachments.map(a => `\`${pathOf(a.ref)}\``).join(', ')}`);
      }
      if (body) lines.push(body);
      return lines.join('\n');
    };
    if (items.length === 1 && items[0]) {
      return render(items[0]);
    }
    return items.map((item, i) => `${i + 1}. ${render(item).replaceAll('\n', '\n   ')}`).join('\n');
  }

  checkOff(ids: number[]): boolean {
    return this.prefs.check_on_copy && this.setDone(ids, true);
  }

  setZoom(zoom: number): number {
    const clamped = Math.round(Math.min(2, Math.max(0.6, zoom)) * 100) / 100;
    this.prefs.zoom = clamped;
    return clamped;
  }

  setTheme(theme: Theme): void {
    this.prefs.theme = theme;
  }

  setCheckOnCopy(shouldCheckOnCopy: boolean): void {
    this.prefs.check_on_copy = shouldCheckOnCopy;
  }

  setGroupDone(shouldGroupDone: boolean): void {
    this.prefs.group_done = shouldGroupDone;
  }

  setUpdateChannel(channel: UpdateChannel): boolean {
    if (this.prefs.update_channel === channel) return false;
    this.prefs.update_channel = channel;
    return true;
  }
}
