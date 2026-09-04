import type {
  FileName,
  GestureInput,
  Host,
  Permissions,
  Theme,
  UpdateChannel,
  UpdateInfo,
} from '@jogpad/ui';
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
  window: {
    show: ({ focus }: { focus: boolean }) => invoke<void>('show_window', { focus }),
    hide: () => invoke<void>('hide_window'),
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
    check: (channel: UpdateChannel) => invoke<UpdateInfo | null>('check_update', { channel }),
    install: (channel: UpdateChannel) => invoke<void>('install_update', { channel }),
  },
  settings: {
    open: () => invoke<void>('open_settings'),
  },
  onGesture: (h: (g: GestureInput) => void) => listen<GestureInput>('gesture', e => h(e.payload)),
};
