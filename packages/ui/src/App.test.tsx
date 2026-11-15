// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { App } from './App.tsx';
import { HostProvider } from './context.tsx';
import { createMemoryHost } from './memory-host.ts';
import { createStore } from './store.ts';

afterEach(cleanup);

// jsdom has no matchMedia; the theme hook asks it for the system appearance.
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

// Nor isContentEditable, which tells the key handler an item is being edited.
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  get(this: HTMLElement) {
    return this.closest('[contenteditable="true"]') !== null;
  },
});

async function renderPad() {
  const host = createMemoryHost('## Inbox\n\n- [ ] one\n- [ ] two\n');
  const store = await createStore(host);
  render(
    <HostProvider host={host} store={store}>
      <App />
    </HostProvider>,
  );
  const texts = () => store.snapshot().pages[0]?.items.map(i => i.text);
  fireEvent.click(screen.getByText('one'));
  fireEvent.keyDown(document.body, { key: 'Backspace' });
  await screen.findByText('1 item removed');
  expect(texts()).toEqual(['two']);
  return { texts };
}

const commandZ = (target: Element) => fireEvent.keyDown(target, { key: 'z', metaKey: true });

test('⌘Z in the list brings the deleted items back', async () => {
  const { texts } = await renderPad();
  commandZ(document.body);
  expect(texts()).toEqual(['one', 'two']);
  expect(screen.queryByText('1 item removed')).toBeNull();
});

test('⌘Z while typing is left to the field, and the Undo button still works', async () => {
  const { texts } = await renderPad();

  commandZ(screen.getByPlaceholderText('Next prompt'));
  expect(texts(), 'the composer keeps ⌘Z').toEqual(['two']);

  fireEvent.doubleClick(screen.getByText('two'));
  const editor = screen.getByText('two');
  expect(editor.isContentEditable).toBe(true);
  commandZ(editor);
  expect(texts(), 'an item being edited keeps ⌘Z').toEqual(['two']);
  expect(screen.getByText('1 item removed')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
  expect(texts()).toEqual(['one', 'two']);
});
