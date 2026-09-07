import { FileIcon, PlayIcon, XIcon } from '@phosphor-icons/react';
import { isImage, isVideo } from '../model.ts';
import { cn } from '../utils.ts';

/// Something the strip can draw: a saved attachment or a file still in the
/// composer. `url` is whatever an <img> can load.
export type Thumb = { key: string; name: string; url: string };

/// The strip that leads an item, or waits above the composer: thumbnails for
/// pictures and clips, a named chip for anything else. Click opens the
/// preview; the corner cross takes it away.
export function AttachmentStrip({
  items,
  onOpen,
  onRemove,
  className,
}: {
  items: Thumb[];
  onOpen?: (t: Thumb) => void;
  onRemove?: (t: Thumb) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {items.map(a => (
        // Only the thumbnails keep clicks to themselves: a click on a picture
        // opens it and a double-click must not start editing the text. The
        // gaps around them still select the row.
        <div
          key={a.key}
          className="group/att relative"
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onOpen?.(a)}
            aria-label={onOpen ? `Open ${a.name}` : a.name}
            className={cn(
              'block overflow-hidden rounded-md ring-1 ring-foreground/10 outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring',
              onOpen ? 'active:scale-[0.98]' : 'cursor-default',
              isImage(a.name) || isVideo(a.name) ? 'h-14 bg-muted' : 'h-7',
            )}
          >
            {isImage(a.name) ? (
              <img
                src={a.url}
                alt={a.name}
                draggable={false}
                className="h-full max-w-28 object-cover"
              />
            ) : isVideo(a.name) ? (
              <span className="relative block h-full">
                {/* WebKit paints nothing for a video it has only read the
                    metadata of. Seeking a hair past the start makes it
                    decode and show the first frame. */}
                <video
                  src={`${a.url}#t=0.001`}
                  muted
                  playsInline
                  preload="auto"
                  className="h-full max-w-28 object-cover"
                />
                <PlayIcon
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
              <XIcon className="size-2.5" weight="bold" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/// The files in a paste or a drop, or none.
export function filesFrom(dt: DataTransfer | null): File[] {
  return Array.from(dt?.files ?? []);
}
