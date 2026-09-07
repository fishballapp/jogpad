import type { AttachmentRef, Host } from './host.ts';
import { extensionOf } from './model.ts';

/// Attachments that live in a Map: the site's demo and the desktop's browser
/// dev host. Refs are hashed the same way as on disk so notes written here
/// would mean the same thing there.
export function createMemoryAttachments(): Host['attachments'] {
  const blobs = new Map<AttachmentRef, Blob>();
  const urls = new Map<AttachmentRef, string>();
  return {
    put: async (bytes, name) => {
      const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
      const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const ref = `attachments/${hex}.${extensionOf(name) || 'bin'}`;
      if (!blobs.has(ref)) blobs.set(ref, new Blob([bytes as BlobPart]));
      return ref;
    },
    url: ref => {
      let url = urls.get(ref);
      if (!url) {
        const blob = blobs.get(ref);
        if (!blob) return '';
        url = URL.createObjectURL(blob);
        urls.set(ref, url);
      }
      return url;
    },
    path: async ref => ref,
    reveal: async () => {
      throw new Error('Nothing to reveal: attachments live in memory here.');
    },
    preview: async a => {
      const url = urls.get(a.ref) ?? URL.createObjectURL(blobs.get(a.ref) ?? new Blob());
      urls.set(a.ref, url);
      window.open(url, '_blank');
    },
    copyImage: async ref => {
      const blob = blobs.get(ref);
      if (!blob) throw new Error('That attachment is gone.');
      // Browsers only take PNG. Anything else goes through a canvas.
      const png = await toPng(blob, ref);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    },
  };
}

async function toPng(blob: Blob, ref: AttachmentRef): Promise<Blob> {
  if (extensionOf(ref) === 'png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Could not convert the image'))),
      'image/png',
    ),
  );
}
