import type {
  Attachment,
  AttachmentRef,
  FileName,
  GestureInput,
  Host,
  Permissions,
  Theme,
  UpdateChannel,
  UpdateInfo,
} from '@jogpad/ui';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

export const inTauri = '__TAURI_INTERNALS__' in window;

type RawPermissions = { trusted: boolean; input_monitoring: boolean };

export const tauriHost: Host = {
  fs: {
    read: (name: FileName) => invoke<string | null>('fs_read', { name }),
    write: (name: FileName, text: string) => invoke<void>('fs_write', { name, text }),
    watch: (name: FileName, cb: () => void) =>
      listen<{ name: FileName }>('fs-changed', e => e.payload.name === name && cb()),
    describe: (name: FileName) => invoke<string>('fs_describe', { name }),
    reveal: (name: FileName) => invoke<void>('fs_reveal', { name }),
  },
  clipboard: {
    write: (text: string) => writeText(text),
  },
  attachments: {
    // Raw body, not JSON: a screenshot as a JSON array of numbers is slow.
    put: (bytes: Uint8Array, name: string) =>
      invoke<AttachmentRef>('attachment_write', bytes, {
        headers: { 'x-name': encodeURIComponent(name) },
      }),
    // Served by Rust under its own scheme, so no asset-scope config and no
    // async path lookup before a row can render.
    url: (ref: AttachmentRef) => `attachment://localhost/${ref.slice('attachments/'.length)}`,
    path: (ref: AttachmentRef) => invoke<string>('attachment_path', { attachmentRef: ref }),
    reveal: (ref: AttachmentRef) => invoke<void>('attachment_reveal', { attachmentRef: ref }),
    remove: (ref: AttachmentRef) => invoke<void>('attachment_remove', { attachmentRef: ref }),
    copyImage: (ref: AttachmentRef) =>
      invoke<void>('attachment_copy_image', { attachmentRef: ref }),
    preview: (a: Attachment) =>
      invoke<void>('open_preview', { attachmentRef: a.ref, name: a.name }),
  },
  window: {
    show: ({ focus }: { focus: boolean }) => invoke<void>('show_window', { focus }),
    hide: () => invoke<void>('hide_window'),
    activate: () => invoke<void>('activate'),
    close: () => getCurrentWindow().hide(),
    quit: () => invoke<void>('quit'),
    startDragging: () => void getCurrentWindow().startDragging(),
    onFocusChanged: (h: (focused: boolean) => void) =>
      getCurrentWindow().onFocusChanged(({ payload }) => h(payload)),
    setZoom: (zoom: number) => invoke<void>('set_zoom', { zoom }),
    setTheme: (theme: Theme) => invoke<void>('set_theme', { theme }),
  },
  permissions: {
    status: async (): Promise<Permissions> => {
      const res = await invoke<RawPermissions>('permissions');
      return { trusted: res.trusted, inputMonitoring: res.input_monitoring };
    },
    onChange: (h: (p: Permissions) => void) =>
      listen<RawPermissions>('permissions', e =>
        h({ trusted: e.payload.trusted, inputMonitoring: e.payload.input_monitoring }),
      ),
    request: () => invoke<void>('request_permissions'),
  },
  updates: {
    version: () => getVersion(),
    check: (channel: UpdateChannel) => invoke<UpdateInfo | null>('check_update', { channel }),
    install: (channel: UpdateChannel) => invoke<void>('install_update', { channel }),
  },
  settings: {
    open: () => invoke<void>('open_settings'),
  },
  onGesture: (h: (g: GestureInput) => void) => listen<GestureInput>('gesture', e => h(e.payload)),
};
