import { ArrowSquareOut, Copy, File as FileIcon, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './components/ui/button.tsx';
import { useHost, useSnapshot } from './context.tsx';
import { type Attachment, extensionOf, isImage, isVideo } from './model.ts';
import { useTheme } from './theme.ts';
import { useToast } from './toast.tsx';

/// One attachment over the whole screen. Its own window on the desktop, the
/// size of the display, transparent behind the dim. What to show comes from
/// the URL, written by the command that opened the window.
export default function PreviewWindow() {
  const host = useHost();
  const snap = useSnapshot();
  useTheme(snap.theme);
  const { flash, toast } = useToast();
  // The window is only ever hidden, never closed, and the next open
  // navigates it afresh. So once it goes, render nothing: that unmounts the
  // video, which would otherwise keep playing behind an invisible window.
  const [gone, setGone] = useState(false);
  const params = new URLSearchParams(location.search);
  const a: Attachment = { ref: params.get('ref') ?? '', name: params.get('name') ?? '' };
  const close = useCallback(() => {
    setGone(true);
    void host.window.close();
  }, [host]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.metaKey && e.key.toLowerCase() === 'w')) {
        e.preventDefault();
        close();
      }
    };
    // Hidden by someone else, such as the pad hiding on ⌘W: same teardown.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setGone(true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [close]);

  const run = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
      toast(label);
    } catch (e) {
      toast(`${e instanceof Error ? e.message : e}`);
    }
  };

  const url = host.attachments.url(a.ref);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (gone) return null;
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 p-10 font-sans text-foreground backdrop-blur-sm"
      onClick={close}
    >
      {isImage(a.name) ? (
        <img
          src={url}
          alt={a.name}
          onClick={stop}
          className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        />
      ) : isVideo(a.name) ? (
        // biome-ignore lint/a11y/useMediaCaption: the user's own clip, with no captions to give it
        <video
          src={url}
          controls
          autoPlay
          loop
          onClick={stop}
          className="max-h-[80vh] max-w-[90vw] rounded-lg shadow-2xl"
        />
      ) : (
        <div
          onClick={stop}
          className="flex flex-col items-center gap-2 rounded-lg bg-popover px-16 py-12 text-muted-foreground shadow-2xl"
        >
          <FileIcon className="size-16" weight="thin" />
          <span className="text-xs tracking-wide uppercase">{extensionOf(a.name) || 'file'}</span>
        </div>
      )}
      <div
        onClick={stop}
        className="flex max-w-[90vw] items-center gap-1 rounded-full bg-popover py-1 pr-1 pl-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10"
      >
        <span className="mr-2 max-w-64 truncate">{flash ?? a.name}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => run('Shown in Finder', () => host.attachments.reveal(a.ref))}
        >
          <ArrowSquareOut /> Reveal in Finder
        </Button>
        {isImage(a.name) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => run('Copied image', () => host.attachments.copyImage(a.ref))}
          >
            <Copy /> Copy image
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              run('Copied path', async () =>
                host.clipboard.write(await host.attachments.path(a.ref)),
              )
            }
          >
            <Copy /> Copy path
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close">
          <X />
        </Button>
      </div>
    </div>
  );
}
