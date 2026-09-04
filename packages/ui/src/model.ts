export type Item = { id: number; text: string; done: boolean };
export type Page = { name: string; items: Item[] };
export type Doc = { pages: Page[] };
export const DEFAULT_PAGE = 'Inbox';

let nextId = 1;

function splitLines(text: string): string[] {
  if (!text) return [];
  let s = text;
  if (s.endsWith('\r\n')) {
    s = s.slice(0, -2);
  } else if (s.endsWith('\n')) {
    s = s.slice(0, -1);
  }
  return s.split(/\r?\n/);
}

export function parseDoc(markdown: string): Doc {
  const pages: Page[] = [];
  let pendingBlanks = 0;

  for (const line of splitLines(markdown)) {
    if (line.startsWith('## ')) {
      pages.push({
        name: line.slice(3).trim(),
        items: [],
      });
      pendingBlanks = 0;
      continue;
    }

    let bullet: { done: boolean; text: string } | null = null;
    if (line.startsWith('- [ ] ')) {
      bullet = { done: false, text: line.slice(6) };
    } else if (line.startsWith('- [x] ') || line.startsWith('- [X] ')) {
      bullet = { done: true, text: line.slice(6) };
    } else if (line.startsWith('- ')) {
      bullet = { done: false, text: line.slice(2) };
    }

    if (bullet) {
      let page = pages[pages.length - 1];
      if (!page) {
        page = {
          name: DEFAULT_PAGE,
          items: [],
        };
        pages.push(page);
      }
      page.items.push({
        id: nextId++,
        text: bullet.text,
        done: bullet.done,
      });
      pendingBlanks = 0;
      continue;
    }

    if (line.trim() === '') {
      pendingBlanks++;
      continue;
    }

    if (line.startsWith('  ')) {
      const rest = line.slice(2);
      const lastPage = pages[pages.length - 1];
      const lastItem = lastPage?.items[lastPage.items.length - 1];
      if (lastItem) {
        for (let i = 0; i < pendingBlanks; i++) {
          lastItem.text += '\n';
        }
        lastItem.text += '\n';
        lastItem.text += rest;
        pendingBlanks = 0;
        continue;
      }
    }

    pendingBlanks = 0;
  }

  if (pages.length === 0) {
    pages.push({
      name: DEFAULT_PAGE,
      items: [],
    });
  }

  return { pages };
}

export function serialiseDoc(doc: Doc): string {
  let out = '';
  for (const page of doc.pages) {
    out += `## ${page.name}\n\n`;
    for (const item of page.items) {
      out += item.done ? '- [x] ' : '- [ ] ';
      const lines = item.text.split('\n');
      if (lines.length > 0) {
        out += lines[0];
      }
      for (let i = 1; i < lines.length; i++) {
        out += '\n';
        if (lines[i] !== '') {
          out += `  ${lines[i]}`;
        }
      }
      out += '\n';
    }
    out += '\n';
  }
  return out;
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

export function parsePrefs(json: string | null): { prefs: Prefs; extra: Record<string, unknown> } {
  if (json === null) {
    return { prefs: { ...defaultPrefs }, extra: {} };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { prefs: { ...defaultPrefs }, extra: {} };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { prefs: { ...defaultPrefs }, extra: {} };
  }

  const raw = obj as Record<string, unknown>;
  const extra: Record<string, unknown> = {};

  const knownKeys = new Set([
    'active',
    'zoom',
    'update_channel',
    'check_on_copy',
    'group_done',
    'theme',
  ]);

  for (const [k, v] of Object.entries(raw)) {
    if (!knownKeys.has(k)) {
      extra[k] = v;
    }
  }

  const active = typeof raw.active === 'string' ? raw.active : defaultPrefs.active;
  const zoom =
    typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? raw.zoom : defaultPrefs.zoom;
  const update_channel: UpdateChannel =
    raw.update_channel === 'beta' || raw.update_channel === 'dev' ? raw.update_channel : 'stable';
  const check_on_copy = typeof raw.check_on_copy === 'boolean' ? raw.check_on_copy : true;
  const group_done = typeof raw.group_done === 'boolean' ? raw.group_done : true;
  const theme: Theme = raw.theme === 'light' || raw.theme === 'system' ? raw.theme : 'dark';

  return {
    prefs: {
      active,
      zoom,
      update_channel,
      check_on_copy,
      group_done,
      theme,
    },
    extra,
  };
}

export class Model {
  doc: Doc;
  prefs: Prefs;

  constructor(doc: Doc, prefs: Prefs) {
    this.doc = doc;
    this.prefs = prefs;
  }

  private pageMut(name: string): Page {
    let page = this.doc.pages.find(p => p.name === name);
    if (!page) {
      page = { name, items: [] };
      this.doc.pages.push(page);
    }
    return page;
  }

  private itemMut(id: number): Item | undefined {
    for (const page of this.doc.pages) {
      const item = page.items.find(i => i.id === id);
      if (item) return item;
    }
    return undefined;
  }

  private takeItems(ids: number[]): Item[] {
    const idSet = new Set(ids);
    const taken: Item[] = [];
    for (const page of this.doc.pages) {
      const kept: Item[] = [];
      for (const item of page.items) {
        if (idSet.has(item.id)) {
          taken.push(item);
        } else {
          kept.push(item);
        }
      }
      page.items = kept;
    }
    return taken;
  }

  private itemsInOrder(ids: number[]): Item[] {
    const idSet = new Set(ids);
    const matched: Item[] = [];
    for (const page of this.doc.pages) {
      for (const item of page.items) {
        if (idSet.has(item.id)) {
          matched.push(item);
        }
      }
    }
    return matched;
  }

  addItem(text: string, page?: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    let pageName: string;
    if (page !== undefined) {
      const norm = normalisePageName(page);
      if (!norm) return null;
      pageName = norm;
    } else {
      pageName = this.prefs.active;
    }

    const id = nextId++;
    this.pageMut(pageName).items.push({
      id,
      text: trimmed,
      done: false,
    });
    return id;
  }

  updateItem(id: number, text: string): boolean {
    if (text.trim() === '') {
      return this.takeItems([id]).length > 0;
    }
    const item = this.itemMut(id);
    if (item) {
      item.text = text;
      return true;
    }
    return false;
  }

  toggleItem(id: number): boolean {
    const item = this.itemMut(id);
    if (item) {
      item.done = !item.done;
      return true;
    }
    return false;
  }

  setDone(ids: number[], done: boolean): boolean {
    let changed = false;
    for (const id of ids) {
      const item = this.itemMut(id);
      if (item && item.done !== done) {
        item.done = done;
        changed = true;
      }
    }
    return changed;
  }

  deleteItems(ids: number[]): boolean {
    this.takeItems(ids);
    return true;
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
    if (ordered.length < 2) {
      return false;
    }
    const first = ordered[0];
    if (!first) {
      return false;
    }
    const text = ordered.map(i => i.text).join('\n\n');
    const keepId = first.id;
    const toRemove = ordered.slice(1).map(i => i.id);
    this.takeItems(toRemove);
    const item = this.itemMut(keepId);
    if (item) {
      item.text = text;
    }
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
    if (this.doc.pages.some(s => s.name === normTo)) {
      return false;
    }
    const page = this.doc.pages.find(s => s.name === from);
    if (!page) {
      return false;
    }
    page.name = normTo;
    if (this.prefs.active === from) {
      this.prefs.active = normTo;
    }
    return true;
  }

  deletePage(page: string): boolean {
    this.doc.pages = this.doc.pages.filter(s => s.name !== page);
    if (this.doc.pages.length === 0) {
      this.pageMut(DEFAULT_PAGE);
    }
    if (this.prefs.active === page) {
      this.prefs.active = this.doc.pages[0]?.name ?? DEFAULT_PAGE;
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

    let targetPage: Page;
    if (before !== null) {
      const homeIndex = this.doc.pages.findIndex(p => p.items.some(i => i.id === before));
      const found = homeIndex >= 0 ? this.doc.pages[homeIndex] : undefined;
      targetPage = found ?? this.pageMut(normPage);
    } else {
      targetPage = this.pageMut(normPage);
    }

    let index = targetPage.items.length;
    if (before !== null) {
      const bIndex = targetPage.items.findIndex(i => i.id === before);
      if (bIndex >= 0) {
        index = bIndex;
      }
    }

    targetPage.items.splice(index, 0, ...taken);

    const after = layout(this.doc.pages);
    if (original.length !== after.length) return true;
    for (let i = 0; i < original.length; i++) {
      const oItems = original[i];
      const aItems = after[i];
      if (!oItems || !aItems || oItems.length !== aItems.length) return true;
      for (let j = 0; j < oItems.length; j++) {
        if (oItems[j] !== aItems[j]) return true;
      }
    }
    return false;
  }

  listText(ids: number[]): string {
    const items = this.itemsInOrder(ids);
    if (items.length === 1 && items[0]) {
      return items[0].text;
    }
    return items.map((item, i) => `${i + 1}. ${item.text.replaceAll('\n', '\n   ')}`).join('\n');
  }

  checkOff(ids: number[]): boolean {
    if (!this.prefs.check_on_copy) {
      return false;
    }
    let changed = false;
    for (const id of ids) {
      const item = this.itemMut(id);
      if (item && !item.done) {
        item.done = true;
        changed = true;
      }
    }
    return changed;
  }

  setZoom(zoom: number): number {
    const clamped = Math.round(Math.min(2, Math.max(0.6, zoom)) * 100) / 100;
    this.prefs.zoom = clamped;
    return clamped;
  }

  setTheme(theme: Theme): void {
    this.prefs.theme = theme;
  }

  setCheckOnCopy(value: boolean): void {
    this.prefs.check_on_copy = value;
  }

  setGroupDone(value: boolean): void {
    this.prefs.group_done = value;
  }

  setUpdateChannel(channel: UpdateChannel): boolean {
    if (this.prefs.update_channel === channel) {
      return false;
    }
    this.prefs.update_channel = channel;
    return true;
  }
}
