import assert from 'node:assert/strict';
import test from 'node:test';
import { runGesture } from './gesture.ts';
import type { Host } from './host.ts';
import type { Store } from './store.ts';

function createSpies() {
  const calls: Array<{ name: string; arg?: unknown }> = [];

  const store = {
    capture: async (text: string) => {
      calls.push({ name: 'capture', arg: text });
    },
  } as unknown as Store;

  const host = {
    window: {
      hide: async () => {
        calls.push({ name: 'hide' });
      },
      show: async (opts: { focus: boolean }) => {
        calls.push({ name: 'show', arg: opts });
      },
    },
  } as unknown as Host;

  return { calls, store, host };
}

test('focused: only hide', async () => {
  const { calls, store, host } = createSpies();
  await runGesture({ focused: true, selection: 'hello' }, store, host);
  assert.deepEqual(calls, [{ name: 'hide' }]);
});

test('selection: capture then show({focus: false}) in that order', async () => {
  const { calls, store, host } = createSpies();
  await runGesture({ focused: false, selection: 'selected text' }, store, host);
  assert.deepEqual(calls, [
    { name: 'capture', arg: 'selected text' },
    { name: 'show', arg: { focus: false } },
  ]);
});

test('neither: show({focus: true}) only', async () => {
  const { calls, store, host } = createSpies();
  await runGesture({ focused: false, selection: null }, store, host);
  assert.deepEqual(calls, [{ name: 'show', arg: { focus: true } }]);
});
