import { ArrowSquareOut, Copy, File as FileIcon, Play, Trash, X } from '@phosphor-icons/react';
import { useHost } from '../context.tsx';
import { type Attachment, extensionOf, isImage, isVideo } from '../model.ts';
import { cn } from '../utils.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.tsx';

/// The strip that leads an item, or waits above the composer: thumbnails for
/// pictures and clips, a named chip for anything else. Click opens the
/// preview. `onRemove` is only for the composer, where nothing is saved yet.
export function AttachmentStrip({
  attachments,
  onOpen,
  onRemove,
  className,
}: {
  attachments: Attachment[];
  onOpen: (a: Attachment) => void;
  onRemove?: (a: Attachment) => void;
  className?: string;
}) {
  const host = useHost();
  if (attachments.length === 0) return null;
  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      // A click here opens a picture, not the row; a double-click must not
      // start editing the text underneath it.
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    >
      {attachments.map(a => (
        <div key={a.ref} className="group/att relative">
          <button
            type="button"
            onClick={() => onOpen(a)}
            aria-label={`Open ${a.name}`}
            className={cn(
              'block overflow-hidden rounded-md ring-1 ring-foreground/10 outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
              isImage(a.name) || isVideo(a.name) ? 'h-14 bg-muted' : 'h-7',
            )}
          >
            {isImage(a.name) ? (
              <img
                src={host.attachments.url(a.ref)}
                alt={a.name}
                draggable={false}
                className="h-full max-w-28 object-cover"
              />
            ) : isVideo(a.name) ? (
              <span className="relative block h-full">
                <video
                  src={host.attachments.url(a.ref)}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full max-w-28 object-cover"
                />
                <Play
                  weight="fill"
                  className="absolute inset-0 m-auto size-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                />
              </span>
            ) : (
              <span className="flex h-full max-w-40 items-center gap-1 bg-muted px-2 text-xs">
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.name}</span>
              </span>
            )}
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(a)}
              aria-label={`Remove ${a.name}`}
              className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-2.5" weight="bold" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/// One attachment filling the pad, with the ways out of it: where the file
/// is, a copy that pastes as a real image, and removal from its item.
export function AttachmentPreview({
  attachment,
  onClose,
  onRemove,
  onNotice,
}: {
  attachment: Attachment | null;
  onClose: () => void;
  onRemove: () => void;
  onNotice: (message: string) => void;
}) {
  const host = useHost();
  const a = attachment;
  const run = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
      onNotice(label);
    } catch (e) {
      onNotice(`${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <Dialog open={a !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="inset-2 top-2 left-2 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-2 p-2 sm:max-w-none"
      >
        {a && (
          <>
            <div className="flex items-center gap-1 pl-1">
              <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
                {a.name}
              </DialogTitle>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                <X />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
              {isImage(a.name) ? (
                <img
                  src={host.attachments.url(a.ref)}
                  alt={a.name}
                  className="max-h-full max-w-full object-contain"
                />
              ) : isVideo(a.name) ? (
                // biome-ignore lint/a11y/useMediaCaption: the user's own clip, with no captions to give it
                <video
                  src={host.attachments.url(a.ref)}
                  controls
                  autoPlay
                  loop
                  className="max-h-full max-w-full"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 p-6 text-muted-foreground">
                  <FileIcon className="size-10" weight="thin" />
                  <span className="text-xs uppercase tracking-wide">
                    {extensionOf(a.name) || 'file'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
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
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => {
                  onRemove();
                  onClose();
                }}
              >
                <Trash /> Remove
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/// The files in a paste or a drop, or none.
export function filesFrom(dt: DataTransfer | null): File[] {
  return Array.from(dt?.files ?? []);
}
