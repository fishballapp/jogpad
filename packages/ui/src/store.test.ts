import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileName, Host } from './host.ts';
import { createStore } from './store.ts';

/// A host whose writes complete out of order (each one slower than the next)
/// and that echoes every write back as a change event, like the desktop.
function slowHost() {
  const disk = new Map<FileName, string>();
  const watchers = new Map<FileName, Set<() => void>>();
  let delay = 30;
  const writes: string[] = [];
  const removed: string[] = [];
  const host: Host = {
    fs: {
      read: async name => disk.get(name) ?? null,
      write: async (name, text) => {
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
      status: async () => ({ trusted: true, inputMonitoring: true }),
      onChange: async () => () => {},
      request: async () => {},
    },
    updates: { version: async () => 'test', check: async () => null, install: async () => {} },
    settings: { open: async () => {} },
    onGesture: async () => () => {},
  };
  return { host, disk, writes, removed };
}

/// Enough of a File for the store: a name and bytes.
const fakeFile = (name: string) =>
  ({ name, type: '', arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as File;

test('a file goes when its last reference does, and stays while any remains', async () => {
  const { host, removed } = slowHost();
  const store = await createStore(host);
  await store.addItem('one', undefined, [fakeFile('a.png')]);
  await store.addItem('two', undefined, [fakeFile('a.png'), fakeFile('b.pdf')]);
  const [first, second] = store.model.doc.pages[0].items.map(i => i.id);
  assert.ok(first !== undefined && second !== undefined);

  await store.deleteItems([first]);
  assert.deepEqual(removed, [], 'a.png is still on the second item');

  await store.detach(second, 'attachments/a.png');
  assert.deepEqual(removed, ['attachments/a.png']);

  await store.deletePage(store.model.prefs.active);
  assert.deepEqual(removed, ['attachments/a.png', 'attachments/b.pdf']);
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
  assert.deepEqual(removed, []);
});

test('burst of unawaited edits lands in order and the last one wins on disk', async () => {
  const { host, disk, writes } = slowHost();
  const store = await createStore(host);
  writes.length = 0;

  void store.addItem('one');
  void store.addItem('two');
  void store.addItem('three');
  await new Promise(r => setTimeout(r, 150));

  assert.deepEqual(
    writes.map(w => w.split('\n').filter(l => l.startsWith('- ')).length),
    [1, 2, 3],
  );
  assert.equal(disk.get('notes.md'), '## Inbox\n\n- [ ] one\n- [ ] two\n- [ ] three\n\n');
  assert.deepEqual(
    store.snapshot().pages[0]?.items.map(i => i.text),
    ['one', 'two', 'three'],
  );
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
  assert.deepEqual(
    items.map(i => i.text),
    ['a', 'b'],
  );
  // A re-parse would have handed out fresh ids; the originals must survive.
  assert.ok(items.every(i => ids.includes(i.id)));
});

test('a change made by another writer is picked up', async () => {
  const { host } = slowHost();
  const store = await createStore(host);
  // Another window writes through the same host; the store did not.
  await host.fs.write('notes.md', '## Inbox\n\n- [x] from elsewhere\n\n');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(store.snapshot().pages[0]?.items[0]?.text, 'from elsewhere');
});
