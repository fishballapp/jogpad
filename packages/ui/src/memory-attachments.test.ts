import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAttachments } from './memory-attachments.ts';

test('copying a PNG supplies a matching MIME type to ClipboardItem', async () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  let copied: Blob | undefined;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write: async () => {} },
  });
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: class {
      constructor(data: Record<string, Blob>) {
        copied = data['image/png'];
      }
    },
  });
  try {
    const attachments = createMemoryAttachments();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const ref = await attachments.put(bytes, 'shot.png');
    await attachments.copyImage(ref);
    assert.equal(copied?.type, 'image/png');
    assert.deepEqual(new Uint8Array(await copied.arrayBuffer()), bytes);
  } finally {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor);
    else Reflect.deleteProperty(globalThis, 'ClipboardItem');
  }
});
