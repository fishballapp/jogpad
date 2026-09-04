import { ArrowCircleDown, FolderOpen, SlidersHorizontal } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button } from './components/ui/button.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import { useHost, useSnapshot, useStore } from './context.tsx';
import type { UpdateInfo } from './host.ts';
import type { Theme, UpdateChannel } from './model.ts';
import { useTheme } from './theme.ts';
import { cn } from './utils.ts';

const CATEGORIES = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'updates', label: 'Updates', icon: ArrowCircleDown },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

export default function SettingsWindow() {
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const [category, setCategory] = useState<Category>('general');

  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [notesPath, setNotesPath] = useState('');
  useTheme(snap.theme);

  useEffect(() => {
    void host.fs.describe('notes.md').then(setNotesPath);
  }, [host]);

  // Closing only hides (Rust intercepts the close button the same way), so
  // Escape and Cmd+W are cheap to offer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.metaKey && e.key.toLowerCase() === 'w')) {
        e.preventDefault();
        void host.window.close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [host]);

  const changeChannel = async (channel: UpdateChannel) => {
    if (snap.update_channel === channel) return;
    // The old channel's offer is meaningless on the new one.
    setUpdate(null);
    setStatus(null);
    try {
      await store.setUpdateChannel(channel);
    } catch (e) {
      setStatus(`Could not change update channel: ${e}`);
    }
  };

  const check = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const info = await host.updates.check(snap.update_channel);
      setUpdate(info);
      if (!info) setStatus('JogPad is up to date.');
    } catch (e) {
      setStatus(`Update check failed: ${e}`);
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    try {
      await host.updates.install(snap.update_channel);
    } catch (e) {
      // Rust took the pending update before installing, so the offer is spent
      // whether or not it worked.
      setInstalling(false);
      setUpdate(null);
      setStatus(`Installation failed: ${e}`);
    }
  };

  return (
    <div className="flex h-full bg-background text-sm">
      <aside className="w-36 shrink-0 space-y-0.5 border-r bg-muted/40 p-2">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
              category === c.id
                ? 'bg-accent font-medium'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            <c.icon className="size-4 shrink-0" /> {c.label}
          </button>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        {category === 'general' && (
          <div className="flex flex-col gap-4">
            <label htmlFor="check-on-copy" className="flex cursor-default items-start gap-2.5">
              <Checkbox
                id="check-on-copy"
                checked={snap.check_on_copy}
                onCheckedChange={checked => void store.setCheckOnCopy(checked === true)}
                className="mt-0.5"
              />
              <span>
                Check off items when copying
                <span className="block text-xs text-muted-foreground">
                  Copied items are marked as done.
                </span>
              </span>
            </label>
            <label htmlFor="group-done" className="flex cursor-default items-start gap-2.5">
              <Checkbox
                id="group-done"
                checked={snap.group_done}
                onCheckedChange={checked => void store.setGroupDone(checked === true)}
                className="mt-0.5"
              />
              <span>
                Group done items at the bottom
                <span className="block text-xs text-muted-foreground">
                  Done items gather under a divider at the bottom of the list.
                </span>
              </span>
            </label>

            <div>
              <p className="mb-1.5 font-medium">Appearance</p>
              <div className="flex gap-1">
                {(['dark', 'light', 'system'] as const satisfies readonly Theme[]).map(theme => (
                  <Button
                    key={theme}
                    size="sm"
                    variant={snap.theme === theme ? 'default' : 'outline'}
                    onClick={() => void store.setTheme(theme)}
                  >
                    {theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System'}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 font-medium">Zoom</p>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Zoom out"
                  disabled={snap.zoom <= 0.6}
                  onClick={() => void store.setZoom(snap.zoom - 0.1)}
                >
                  −
                </Button>
                <span className="w-12 text-center tabular-nums">
                  {Math.round(snap.zoom * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Zoom in"
                  disabled={snap.zoom >= 2}
                  onClick={() => void store.setZoom(snap.zoom + 0.1)}
                >
                  +
                </Button>
                {snap.zoom !== 1 && (
                  <Button size="sm" variant="ghost" onClick={() => void store.setZoom(1)}>
                    Reset
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                ⌘− and ⌘+ in the panel do the same. Applies to this window too.
              </p>
            </div>

            <div>
              <p className="mb-1.5 font-medium">Notes file</p>
              <p className="mb-1.5 text-xs break-all text-muted-foreground">{notesPath}</p>
              <Button size="sm" variant="outline" onClick={() => void host.fs.reveal('notes.md')}>
                <FolderOpen /> Show in Finder
              </Button>
            </div>
          </div>
        )}

        {category === 'updates' && (
          <div className="flex flex-col items-start gap-4">
            <div>
              <p className="mb-1.5 font-medium">Channel</p>
              <div className="flex gap-1">
                {(['stable', 'beta', 'dev'] as const).map(channel => (
                  <Button
                    key={channel}
                    size="sm"
                    variant={snap.update_channel === channel ? 'default' : 'outline'}
                    onClick={() => void changeChannel(channel)}
                  >
                    {{ stable: 'Stable', beta: 'Beta', dev: 'Dev' }[channel]}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Dev follows every push to main, unreviewed.
              </p>
            </div>

            <Button size="sm" variant="outline" disabled={checking} onClick={() => void check()}>
              {checking ? 'Checking…' : 'Check for Updates'}
            </Button>

            {update && (
              <div className="w-full rounded-md border p-3">
                <p className="mb-1 font-medium">JogPad {update.version} is available</p>
                {update.notes?.trim() && (
                  <p className="mb-2 max-h-32 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground">
                    {update.notes}
                  </p>
                )}
                <Button size="sm" disabled={installing} onClick={() => void install()}>
                  {installing ? 'Installing…' : 'Install and Restart'}
                </Button>
              </div>
            )}

            {status && <p className="text-xs text-muted-foreground">{status}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
