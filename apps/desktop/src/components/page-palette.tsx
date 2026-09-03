import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import type { Page } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: Page[];
  active: string;
  onPick: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
};

export function PagePalette({
  open,
  onOpenChange,
  pages,
  active,
  onPick,
  onRename,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  // The page being renamed, and the one whose delete is armed. Deleting takes
  // the page's items with it, so it asks twice, unless there are none to take.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setRenaming(null);
      setArmed(null);
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages.filter(s => s.name.toLowerCase().includes(q));
  }, [pages, query]);

  // Offer to create the page only when nothing already has that exact name.
  const creating = query.trim().length > 0 && !pages.some(s => s.name === query.trim());
  const rows = creating ? [...matches, null] : matches;

  // Moving off a row disarms its delete, so the second click always lands on
  // the row the first one armed.
  const moveCursor = (index: number) => {
    setCursor(index);
    setArmed(null);
  };

  const commit = (index: number) => {
    const row = rows[index];
    // Deleting a page shortens the list under a cursor that does not move, so
    // Enter can land past the end. Closing on that would look like a page
    // switch that silently did nothing.
    if (!row && !query.trim()) return;
    onPick(row ? row.name : query.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-20 max-w-[calc(100vw-2rem)] translate-y-0 gap-0 p-0"
      >
        <DialogTitle className="sr-only">Switch page</DialogTitle>
        <input
          autoFocus
          value={query}
          placeholder="Go to or create a page"
          onChange={e => {
            setQuery(e.target.value);
            moveCursor(0);
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              moveCursor(Math.min(cursor + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              moveCursor(Math.max(cursor - 1, 0));
            } else if (e.key === 'Enter' && rows.length > 0) {
              e.preventDefault();
              commit(cursor);
            } else if (e.metaKey && /^[1-9]$/.test(e.key)) {
              // ⌘1–⌘9 pick by visible position, so they follow the filter.
              const index = Number(e.key) - 1;
              if (rows[index]) {
                e.preventDefault();
                commit(index);
              }
            }
          }}
          className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div role="listbox" className="max-h-64 overflow-y-auto border-t p-1">
          {rows.map((row, i) =>
            row && renaming === row.name ? (
              <RenameRow
                key={row.name}
                name={row.name}
                taken={pages.map(p => p.name)}
                onCancel={() => setRenaming(null)}
                onCommit={to => {
                  setRenaming(null);
                  onRename(row.name, to);
                }}
              />
            ) : (
              <div
                key={row ? row.name : '__new'}
                role="option"
                // The palette's input owns the keyboard, so rows are pointer
                // targets that never take focus away from it.
                tabIndex={-1}
                aria-selected={i === cursor}
                onMouseEnter={() => moveCursor(i)}
                onClick={() => commit(i)}
                className={cn(
                  'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                  i === cursor && 'bg-accent text-accent-foreground',
                )}
              >
                {row ? (
                  <>
                    {i < 9 ? (
                      <Kbd className="w-8 shrink-0">⌘{i + 1}</Kbd>
                    ) : (
                      <span className="w-8 shrink-0" />
                    )}
                    <span className="truncate">{row.name}</span>
                    {row.name === active && <Kbd className="ml-1">now</Kbd>}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {armed === row.name ? (
                        <span className="text-xs text-destructive">
                          Delete {row.items.length} item{row.items.length === 1 ? '' : 's'}?
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{row.items.length}</span>
                      )}
                      {i === cursor && (
                        <>
                          <RowAction
                            label={`Rename ${row.name}`}
                            onClick={() => {
                              setArmed(null);
                              setRenaming(row.name);
                            }}
                          >
                            <PencilSimple className="size-3.5" />
                          </RowAction>
                          <RowAction
                            label={
                              armed === row.name
                                ? `Confirm deleting ${row.name}`
                                : `Delete ${row.name}`
                            }
                            onClick={() => {
                              if (armed === row.name || row.items.length === 0) {
                                setArmed(null);
                                onDelete(row.name);
                              } else {
                                setArmed(row.name);
                              }
                            }}
                          >
                            <Trash
                              className={cn('size-3.5', armed === row.name && 'text-destructive')}
                            />
                          </RowAction>
                        </>
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5 shrink-0 opacity-50" />
                    <span className="truncate">Create "{query.trim()}"</span>
                  </>
                )}
              </div>
            ),
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // The whole row picks the page, so an action click must not also switch.
      onClick={e => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-0.5 opacity-60 hover:bg-background/60 hover:opacity-100"
    >
      {children}
    </button>
  );
}

function RenameRow({
  name,
  taken,
  onCancel,
  onCommit,
}: {
  name: string;
  taken: string[];
  onCancel: () => void;
  onCommit: (to: string) => void;
}) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  // Focus and select, so typing replaces the old name outright.
  useEffect(() => ref.current?.select(), []);
  const to = value.trim();
  // Rust refuses a rename onto a name that already exists, and silently. Say so
  // here instead of letting Enter look broken.
  const clash = to !== name && taken.includes(to);

  return (
    <div className="flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm">
      <PencilSimple className="size-3.5 shrink-0 opacity-50" />
      <input
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={onCancel}
        onKeyDown={e => {
          // Escape belongs to the rename, not to the dialog behind it.
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!to || clash || to === name) return onCancel();
            onCommit(to);
          }
        }}
        className="w-full bg-transparent outline-none"
      />
      {clash && <span className="shrink-0 text-xs text-destructive">Name taken</span>}
    </div>
  );
}
