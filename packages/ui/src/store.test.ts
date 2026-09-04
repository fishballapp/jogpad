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
    updates: { check: async () => null, install: async () => {} },
    settings: { open: async () => {} },
    onGesture: async () => () => {},
  };
  return { host, disk, writes };
}

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
