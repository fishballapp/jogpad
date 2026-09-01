import { ArrowCircleDown, SlidersHorizontal } from '@phosphor-icons/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { api, inTauri, on, type Snapshot, type UpdateChannel, type UpdateInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'updates', label: 'Updates', icon: ArrowCircleDown },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

export default function SettingsWindow() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [category, setCategory] = useState<Category>('general');

  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    // Same discipline as the panel: keep the newest snapshot seen, because
    // events and the initial reply can land out of order.
    const apply = (next: Snapshot) => setSnap(prev => (prev && prev.rev > next.rev ? prev : next));
    const unlisten = on<Snapshot>('notes', e => apply(e.payload));
    unlisten
      .then(() => api.snapshot())
      .then(apply)
      .catch(e => setStatus(String(e)));
    return () => {
      void unlisten.then(f => f());
    };
  }, []);

  // Closing only hides (Rust intercepts the close button the same way), so
  // Escape and Cmd+W are cheap to offer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.metaKey && e.key.toLowerCase() === 'w')) {
        e.preventDefault();
        if (inTauri) void getCurrentWindow().hide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeChannel = async (channel: UpdateChannel) => {
    if (snap?.update_channel === channel) return;
    // The old channel's offer is meaningless on the new one.
    setUpdate(null);
    setStatus(null);
    try {
      await api.setUpdateChannel(channel);
    } catch (e) {
      setStatus(`Could not change update channel: ${e}`);
    }
  };

  const check = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const info = await api.checkUpdate();
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
      await api.installUpdate();
    } catch (e) {
      // Rust took the pending update before installing, so the offer is spent
      // whether or not it worked.
      setInstalling(false);
      setUpdate(null);
      setStatus(`Installation failed: ${e}`);
    }
  };

  if (!snap) return null;

  return (
    <div className="flex h-screen bg-background text-sm">
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
                onCheckedChange={checked => void api.setCheckOnCopy(checked === true)}
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
                onCheckedChange={checked => void api.setGroupDone(checked === true)}
                className="mt-0.5"
              />
              <span>
                Group done items at the bottom
                <span className="block text-xs text-muted-foreground">
                  Done items gather under a divider at the bottom of the list.
                </span>
              </span>
            </label>
          </div>
        )}

        {category === 'updates' && (
          <div className="flex flex-col items-start gap-4">
            <div>
              <p className="mb-1.5 font-medium">Channel</p>
              <div className="flex gap-1">
                {(['stable', 'beta'] as const).map(channel => (
                  <Button
                    key={channel}
                    size="sm"
                    variant={snap.update_channel === channel ? 'default' : 'outline'}
                    onClick={() => void changeChannel(channel)}
                  >
                    {channel === 'stable' ? 'Stable' : 'Beta'}
                  </Button>
                ))}
              </div>
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
