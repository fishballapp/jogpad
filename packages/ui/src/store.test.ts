import { expect, test } from 'vitest';
import type { FileName, Host } from './host.ts';
import { parseDoc } from './model.ts';
import { createStore } from './store.ts';

/**
 * A host whose writes complete out of order (each one slower than the next)
 * and that echoes every write back as a change event, like the desktop.
 */
function slowHost() {
  const disk = new Map<FileName, string>();
  const trayCalls: boolean[] = [];
  const watchers = new Map<FileName, Set<() => void>>();
  let delay = 30;
  const writes: string[] = [];
  const failing = { notes: false };
  const removed: string[] = [];
  const host: Host = {
    fs: {
      read: async name => disk.get(name) ?? null,
      write: async (name, text) => {
        if (failing.notes && name === 'notes.md') throw new Error('disk full');
        const wait = delay;
        delay = Math.max(0, delay - 10);
        await new Promise(r => setTimeout(r, wait));
        disk.set(name, text);
        writes.push(text);
        for (const cb of watchers.get(name) ?? []) cb();
      },
      watch: async (name, cb) => {
        const set = watchers.get(name) ?? new Set();
        watchers.set(name, set);
        set.add(cb);
        return () => set.delete(cb);
      },
      describe: async name => name,
      reveal: async () => {},
    },
    clipboard: { write: async () => {} },
    attachments: {
      put: async (_bytes, name) => `attachments/${name}`,
      url: ref => ref,
      path: async ref => ref,
      reveal: async () => {},
      remove: async ref => {
        removed.push(ref);
      },
      copyImage: async () => {},
      preview: async () => {},
    },
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
      status: async () => ({ isTrusted: true, isInputMonitoringGranted: true }),
      onChange: async () => () => {},
      request: async () => {},
    },
    updates: {
      version: async () => 'test',
      check: async () => null,
      install: async () => {},
      onCheckRequested: async () => () => {},
    },
    settings: { open: async () => {} },
    tray: {
      setVisible: async visible => {
        trayCalls.push(visible);
      },
    },
    onGesture: async () => () => {},
  };
  return { host, disk, writes, removed, failing, trayCalls };
}

test('a write that never landed takes no files away', async () => {
  const { host, removed, failing } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  const id = store.model.doc.pages[0]!.items[0]?.id;
  expect(id).toBeDefined();

  failing.notes = true;
  const removal = await store.deleteItems([id!]);
  if (!removal) throw new Error('nothing was deleted');
  await store.releaseRemoval(removal);
  expect(removed, 'notes.md on disk still mentions a.png').toEqual([]);
  expect(store.snapshot().error ?? '').toMatch(/disk full/);

  // Once a write lands again, the file goes.
  failing.notes = false;
  await store.addItem('two');
  expect(removed).toEqual(['attachments/a.png']);
});

test('brackets in a file name cannot break the link', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  await store.addItem('x', undefined, [fakeFile('report]final[v2].png')]);
  const text = store.model.doc.pages[0]!.items[0]?.text ?? '';
  expect(text).toBe('![reportfinalv2.png](attachments/reportfinalv2.png)\nx');
});

/** Enough of a File for the store: a name and bytes. */
const fakeFile = (name: string) =>
  ({ name, type: '', arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as File;

test('a file goes when its last reference does, and stays while any remains', async () => {
  const { host, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  await store.addItem('two', undefined, [fakeFile('a.png'), fakeFile('b.pdf')]);
  const [first, second] = store.model.doc.pages[0]!.items.map(i => i.id);
  expect(first).toBeDefined();
  expect(second).toBeDefined();

  const removal = await store.deleteItems([first!]);
  if (!removal) throw new Error('nothing was deleted');
  await store.releaseRemoval(removal);
  expect(removed, 'a.png is still on the second item').toEqual([]);

  await store.detach(second!, 'attachments/a.png');
  expect(removed).toEqual(['attachments/a.png']);

  await store.deletePage(store.model.prefs.active);
  expect(removed).toEqual(['attachments/a.png', 'attachments/b.pdf']);
});

test('what an outside edit removed is not ours to trash', async () => {
  const { host, disk, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);

  // Someone else rewrites the file without the attachment.
  disk.set('notes.md', '## Inbox\n\n- [ ] one\n\n');
  await host.fs.write('notes.md', disk.get('notes.md') ?? '');
  await new Promise(r => setTimeout(r, 50));

  await store.addItem('two');
  expect(removed).toEqual([]);
});

test('burst of unawaited edits lands in order and the last one wins on disk', async () => {
  const { host, disk, writes } = slowHost();
  const store = await createStore(host);
  writes.length = 0;

  void store.addItem('one');
  void store.addItem('two');
  void store.addItem('three');
  await new Promise(r => setTimeout(r, 150));

  expect(writes.map(w => w.split('\n').filter(l => l.startsWith('- ')).length)).toEqual([1, 2, 3]);
  expect(disk.get('notes.md')).toBe('## Inbox\n\n- [ ] one\n- [ ] two\n- [ ] three\n\n');
  expect(store.snapshot().pages[0]?.items.map(i => i.text)).toEqual(['one', 'two', 'three']);
});

test('own writes echoed back as changes never roll the model back', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  const ids: number[] = [];
  store.on('notes', s => ids.push(...(s.pages[0]?.items.map(i => i.id) ?? [])));

  void store.addItem('a');
  void store.addItem('b');
  await new Promise(r => setTimeout(r, 150));

  const items = store.snapshot().pages[0]?.items ?? [];
  expect(items.map(i => i.text)).toEqual(['a', 'b']);
  // A re-parse would have handed out fresh ids; the originals must survive.
  expect(items.every(i => ids.includes(i.id))).toBe(true);
});

test('a change made by another writer is picked up', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  // Another window writes through the same host; the store did not.
  await host.fs.write('notes.md', '## Inbox\n\n- [x] from elsewhere\n\n');
  await new Promise(r => setTimeout(r, 10));
  expect(store.snapshot().pages[0]?.items[0]?.text).toBe('from elsewhere');
});

test('hiding the menu-bar icon reaches the host and survives a restart', async () => {
  const { host, trayCalls } = slowHost();
  const store = await createStore(host);
  expect(store.snapshot().show_tray_icon).toBe(true);

  await store.setShowTrayIcon(false);
  expect(trayCalls).toEqual([false]);
  expect(store.snapshot().show_tray_icon).toBe(false);

  const reopened = await createStore(host);
  expect(reopened.snapshot().show_tray_icon).toBe(false);
});

test('creating an empty page persists it across a restart', async () => {
  const { host, disk, writes } = slowHost();
  const store = await createStore(host);
  await store.setActive('Work');
  expect(parseDoc(disk.get('notes.md') ?? '').pages.map(p => p.name)).toEqual(['Inbox', 'Work']);
  const reopened = await createStore(host);
  expect(reopened.snapshot().active).toBe('Work');

  writes.length = 0;
  await store.setActive('Inbox');
  expect(writes.length, 'switching existing pages only writes prefs').toBe(1);
});

test('an overlapping failed deletion keeps attachments referenced by the successful write', async () => {
  const { host, disk, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  const id = store.snapshot().pages[0]!.items[0]!.id;
  const write = host.fs.write;
  host.fs.write = async (name, text) => {
    if (name === 'notes.md' && !text.includes('attachments/a.png')) throw new Error('disk full');
    await write(name, text);
  };

  await Promise.all([store.toggleItem(id), store.deleteItems([id])]);
  expect(disk.get('notes.md') ?? '').toMatch(/attachments\/a.png/);
  expect(removed, 'cleanup must use the document that actually reached disk').toEqual([]);
});

test('another writer can restore an earlier value written by this store', async () => {
  const { host, disk } = slowHost();
  const store = await createStore(host);
  await store.setCheckOnCopy(false);
  const earlier = disk.get('prefs.json') ?? '';
  await store.setCheckOnCopy(true);
  await host.fs.write('prefs.json', earlier);
  expect(store.snapshot().check_on_copy).toBe(false);
});

test('a burst longer than the old write history preserves every item id', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  const writes = Array.from({ length: 40 }, (_, i) => store.capture(`item ${i}`));
  const ids = store.snapshot().pages[0]!.items.map(i => i.id);
  await Promise.all(writes);
  expect(store.snapshot().pages[0]!.items.map(i => i.id)).toEqual(ids);
});

test('snapshots keep their page and item values after later mutations', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  await store.addItem('original');
  const before = store.snapshot();
  await store.updateItem(before.pages[0]!.items[0]!.id, 'edited');
  await store.renamePage('Inbox', 'Renamed');
  await store.setActive('New');
  expect(before.pages.length).toBe(1);
  expect(before.pages[0]!.name).toBe('Inbox');
  expect(before.pages[0]!.items[0]!.text).toBe('original');
  expect(store.snapshot().pages).not.toBe(before.pages);
});

test('a submission keeps its destination while files are being read', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  let finishRead = () => {};
  const file = fakeFile('a.png');
  file.arrayBuffer = () =>
    new Promise(resolve => {
      finishRead = () => resolve(new ArrayBuffer(0));
    });
  const adding = store.addItem('for Inbox', undefined, [file]);
  await store.setActive('Work');
  finishRead();
  await adding;
  expect(store.snapshot().pages.find(p => p.name === 'Inbox')?.items.length).toBe(1);
  expect(store.snapshot().pages.find(p => p.name === 'Work')?.items.length).toBe(0);
});

test('undo puts deleted items back in place, on screen and in the file', async () => {
  const { host, disk } = slowHost();
  const store = await createStore(host);
  for (const text of ['a', 'b', 'c', 'd']) await store.addItem(text);
  const [, b, c] = store.model.doc.pages[0]!.items.map(i => i.id);

  const removal = await store.deleteItems([b!, c!]);
  if (!removal) throw new Error('nothing was deleted');
  expect(disk.get('notes.md')).toBe('## Inbox\n\n- [ ] a\n- [ ] d\n\n');

  await store.restoreItems(removal);
  expect(disk.get('notes.md')).toBe('## Inbox\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n\n');
  expect(store.snapshot().pages[0]?.items.map(i => i.id)).toContain(b);
});

test('undo after further edits keeps those edits', async () => {
  const { host, disk } = slowHost();
  const store = await createStore(host);
  for (const text of ['a', 'b', 'c']) await store.addItem(text);
  const [a, b] = store.model.doc.pages[0]!.items.map(i => i.id);

  const removal = await store.deleteItems([b!]);
  if (!removal) throw new Error('nothing was deleted');
  await store.updateItem(a!, 'a edited');
  await store.capture('captured since');
  await store.toggleItem(a!);

  await store.restoreItems(removal);
  expect(disk.get('notes.md')).toBe(
    '## Inbox\n\n- [x] a edited\n- [ ] b\n- [ ] c\n- [ ] captured since\n\n',
  );
});

test('a deleted item keeps its files until Undo is no longer offered', async () => {
  const { host, disk, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  const id = store.model.doc.pages[0]!.items[0]!.id;

  const removal = await store.deleteItems([id]);
  if (!removal) throw new Error('nothing was deleted');
  // A crash here loses only the item that was meant to go: the file is
  // already without it, and its picture is still on disk.
  expect(disk.get('notes.md')).not.toMatch(/one/);
  await store.addItem('later edit');
  expect(removed).toEqual([]);

  await store.restoreItems(removal);
  expect(disk.get('notes.md')).toMatch(/attachments\/a.png/);

  const again = await store.deleteItems([id]);
  if (!again) throw new Error('nothing was deleted');
  await store.releaseRemoval(again);
  expect(removed).toEqual(['attachments/a.png']);
});

test('undo cannot run twice, nor after its offer was released', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  await store.addItem('one');
  const id = store.model.doc.pages[0]!.items[0]!.id;

  const removal = await store.deleteItems([id]);
  if (!removal) throw new Error('nothing was deleted');
  await store.restoreItems(removal);
  await store.restoreItems(removal);
  expect(store.snapshot().pages[0]?.items.length).toBe(1);

  const again = await store.deleteItems([id]);
  if (!again) throw new Error('nothing was deleted');
  await store.releaseRemoval(again);
  await store.restoreItems(again);
  expect(store.snapshot().pages[0]?.items.length).toBe(0);
});

test('undo while an earlier write is still landing keeps the restored file', async () => {
  const { host, disk, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  await store.addItem('two');
  const [one, two] = store.model.doc.pages[0]!.items.map(i => i.id);

  const removal = await store.deleteItems([one!]);
  if (!removal) throw new Error('nothing was deleted');
  const edit = store.updateItem(two!, 'two edited');
  await Promise.all([edit, store.restoreItems(removal)]);

  expect(removed).toEqual([]);
  expect(disk.get('notes.md')).toMatch(/attachments\/a.png/);
});

test('a file held for Undo is still trashed after someone else edits the notes', async () => {
  const { host, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  await store.addItem('two');
  const [one] = store.model.doc.pages[0]!.items.map(i => i.id);

  const removal = await store.deleteItems([one!]);
  if (!removal) throw new Error('nothing was deleted');
  // Another window writes through the same host; the store did not.
  await host.fs.write('notes.md', '## Inbox\n\n- [ ] two, edited elsewhere\n\n');
  await new Promise(r => setTimeout(r, 10));

  await store.releaseRemoval(removal);
  expect(removed).toEqual(['attachments/a.png']);
});

test('undo after its page was renamed puts the item back on that page', async () => {
  const { host, disk } = slowHost();
  const store = await createStore(host);
  for (const text of ['a', 'b']) await store.addItem(text);
  const [a] = store.model.doc.pages[0]!.items.map(i => i.id);

  const removal = await store.deleteItems([a!]);
  if (!removal) throw new Error('nothing was deleted');
  await store.renamePage('Inbox', 'Today');

  await store.restoreItems(removal);
  expect(disk.get('notes.md')).toBe('## Today\n\n- [ ] a\n- [ ] b\n\n');
});
