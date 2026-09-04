import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowsMerge,
  CaretRight,
  CheckSquare,
  Copy,
  MagnifyingGlass,
  Square,
  Trash,
  X,
} from '@phosphor-icons/react';
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PagePalette } from './components/page-palette.tsx';
import { Panel } from './components/panel.tsx';
import { Button } from './components/ui/button.tsx';
import { Checkbox } from './components/ui/checkbox.tsx';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from './components/ui/context-menu.tsx';
import { Kbd } from './components/ui/kbd.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip.tsx';
import { useHost, useSnapshot, useStore } from './context.tsx';
import type { Item } from './model.ts';
import { useTheme } from './theme.ts';
import { cn } from './utils.ts';

type Row = { item: Item; page: string };

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export default function App({ menu, notice }: { menu?: ReactNode; notice?: ReactNode } = {}) {
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  useTheme(snap.theme);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [palette, setPalette] = useState(false);
  // Done items start folded away under their heading. Per session, not saved.
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  // The panel has no title bar, so nothing else tells you whether typing will
  // land here or in the app behind it.
  const [focused, setFocused] = useState(true);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Anchor is where a range selection started; cursor is the end that moves.
  const anchorRef = useRef<number | null>(null);
  const cursorRef = useRef<number | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void host.window.onFocusChanged(setFocused).then(u => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [host]);

  const toast = useCallback((message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(f => (f === message ? null : f)), 1600);
  }, []);

  useEffect(() => {
    // Capture lands in the active page, so drop any search that would
    // hide the thing that was just captured, then point at it.
    const unlistenCaptured = store.on('captured', id => {
      setQuery('');
      setSearching(false);
      setSelected([id]);
    });
    const unlistenFocusInput = store.on('focus-input', () => {
      composerRef.current?.focus();
    });
    return () => {
      unlistenCaptured();
      unlistenFocusInput();
    };
  }, [store]);

  const q = query.trim().toLowerCase();
  const activeItems = useMemo(
    () => snap.pages.find(s => s.name === snap.active)?.items ?? [],
    [snap],
  );
  // How many rows the Done heading stands for. Zero means no heading at all.
  const doneCount = snap.group_done && !q ? activeItems.filter(i => i.done).length : 0;

  // Searching looks across every page; otherwise you see the active one.
  const rows: Row[] = useMemo(() => {
    if (q) {
      return snap.pages.flatMap(s =>
        s.items.filter(i => i.text.toLowerCase().includes(q)).map(item => ({ item, page: s.name })),
      );
    }
    if (!snap.group_done) return activeItems.map(item => ({ item, page: snap.active }));
    // Grouping is display-only: the markdown file keeps its real order, so
    // unchecking an item sends it back where it always was. Collapsed done
    // items leave the rows entirely, so keys and selection cannot reach them.
    const shown = doneCollapsed
      ? activeItems.filter(i => !i.done)
      : [...activeItems.filter(i => !i.done), ...activeItems.filter(i => i.done)];
    return shown.map(item => ({ item, page: snap.active }));
  }, [snap, q, activeItems, doneCollapsed]);

  // Selection is pruned against what is currently visible, so switching
  // page or typing a search also clears it. Deliberate: acting on rows you
  // cannot see is worse than losing a selection.
  useEffect(() => {
    const live = new Set(rows.map(r => r.item.id));
    setSelected(prev => {
      const next = prev.filter(id => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  const selectRow = (index: number, e: React.MouseEvent) => {
    const row = rows[index];
    if (!row) return;
    const id = row.item.id;
    if (e.metaKey) {
      setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
      anchorRef.current = index;
      cursorRef.current = index;
      return;
    }
    if (e.shiftKey && anchorRef.current !== null) {
      // The anchor is an index into the visible rows, and checking an item
      // while done-grouping is on reorders them under it. Trust it only while
      // it still points at a selected row, like the arrow-key handler does.
      const anchorRow = rows[anchorRef.current];
      if (anchorRow && selected.includes(anchorRow.item.id)) {
        const from = Math.min(anchorRef.current, index);
        const to = Math.max(anchorRef.current, index);
        setSelected(rows.slice(from, to + 1).map(r => r.item.id));
        cursorRef.current = index;
        return;
      }
    }
    setSelected([id]);
    anchorRef.current = index;
    cursorRef.current = index;
  };

  const copySelection = useCallback(
    async (ids = selected) => {
      if (ids.length === 0) return;
      try {
        await store.copyAsList(ids);
      } catch (e) {
        toast(`Could not copy: ${e}`);
        return;
      }
      toast(ids.length > 1 ? `Copied ${ids.length} as a list` : 'Copied');
    },
    [selected, store, toast],
  );

  const submit = async () => {
    const value = composerRef.current?.value ?? '';
    const text = value.trim();
    if (!text) return;
    await store.addItem(text);
    if (composerRef.current) {
      composerRef.current.value = '';
      composerRef.current.style.height = 'auto';
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog covers the list, so a stray Delete would destroy a selection
      // the user cannot even see. Each dialog handles its own Escape.
      if (palette) return;
      const typing = isTypingTarget(e.target);

      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void copySelection();
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearching(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        void host.window.quit();
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        void host.window.hide();
        return;
      }
      if (e.metaKey && (e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
        const zoom = snap.zoom;
        void store.setZoom(e.key === '0' ? 1 : zoom + (e.key === '-' ? -0.1 : 0.1));
        return;
      }
      if (e.key === 'Escape') {
        if (editing !== null) return;
        if (query || searching) {
          setQuery('');
          setSearching(false);
        } else {
          setSelected([]);
        }
        return;
      }
      if (typing) return;

      if (e.metaKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(rows.map(r => r.item.id));
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (selected.length > 0) void store.deleteItems(selected);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        // The refs are indices into the visible rows, so a capture, a page
        // switch or a search leaves them pointing at whatever now sits at that
        // position. Trust them only while they still hold a selected row.
        let cursor = cursorRef.current;
        const currentRow = cursor === null ? undefined : rows[cursor];
        if (cursor === null || !currentRow || !selected.includes(currentRow.item.id)) {
          const hit = rows.flatMap((r, i) => (selected.includes(r.item.id) ? [i] : []));
          const edge = step > 0 ? hit.at(-1) : hit[0];
          cursor = edge ?? (step > 0 ? -1 : rows.length);
          anchorRef.current = edge ?? null;
        }
        const next = Math.max(0, Math.min(rows.length - 1, cursor + step));
        const nextRow = rows[next];
        if (!nextRow) return;
        cursorRef.current = next;
        // Shift grows the range from the anchor; a bare arrow moves both ends.
        if (e.shiftKey && anchorRef.current !== null) {
          const from = Math.min(anchorRef.current, next);
          const to = Math.max(anchorRef.current, next);
          setSelected(rows.slice(from, to + 1).map(r => r.item.id));
        } else {
          anchorRef.current = next;
          setSelected([nextRow.item.id]);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copySelection, editing, host, palette, query, rows, searching, selected, snap.zoom, store]);

  // Clicks must still select and double-clicks still edit, so a drag only
  // starts once the pointer has actually travelled.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex(r => r.item.id === active.id);
    const newIndex = rows.findIndex(r => r.item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const dragged = rows[oldIndex];
    if (!dragged) return;
    // Dragging a selected row brings the rest of the selection along, the
    // same way copy and delete on a selected row already act on all of it.
    const moving = selected.includes(dragged.item.id)
      ? rows.filter(r => selected.includes(r.item.id)).map(r => r.item.id)
      : [dragged.item.id];
    // The dragged row lands at `newIndex`: dragging down pushes the row it
    // passed upward, so the insert point sits just after it.
    const displaced = oldIndex < newIndex ? newIndex + 1 : newIndex;
    // Under grouping the display order is not the file order, so the drop
    // resolves against rows in the dragged item's own done-partition: an
    // "insert before" aimed at the other partition would rewrite the file
    // and then re-partition back to exactly the picture it started from.
    // Rows that are themselves moving cannot be landed on either.
    const landable = (r: Row) =>
      (!snap.group_done || r.item.done === dragged.item.done) && !moving.includes(r.item.id);
    const before = rows.slice(displaced).find(landable)?.item.id ?? null;
    // No adjacency guard here: the backend knows the file order, detects a
    // drop that changes nothing and skips the rewrite itself.
    void store.moveItemsBefore(moving, before, snap.active);
  };

  const allSelectedDone =
    selected.length > 0 && rows.every(r => !selected.includes(r.item.id) || r.item.done);

  const doneHeader = doneCount > 0 && (
    <button
      onClick={() => setDoneCollapsed(c => !c)}
      aria-expanded={!doneCollapsed}
      className="mx-2 mt-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-1 border-t pt-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
    >
      <CaretRight className={cn('size-3 transition-transform', !doneCollapsed && 'rotate-90')} />
      Done
      <span className="font-normal">{doneCount}</span>
    </button>
  );

  return (
    <TooltipProvider>
      <Panel focused={focused}>
        <header
          // The drag-region attribute only fires on the element under the
          // pointer, so the gaps between buttons were the only grabbable
          // pixels. Dragging from anywhere that is not a control is better.
          onPointerDown={e => {
            if ((e.target as HTMLElement).closest('button')) return;
            host.window.startDragging();
          }}
          className="flex shrink-0 cursor-grab items-center gap-1 px-3 py-2 active:cursor-grabbing"
        >
          <button
            onClick={() => setPalette(true)}
            className={cn(
              'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-medium hover:bg-accent',
              !focused && 'text-muted-foreground',
            )}
            aria-label="Switch page"
          >
            <span className="truncate">{snap.active}</span>
            <Kbd>⌘K</Kbd>
          </button>
          <span className="text-xs text-muted-foreground">{rows.length}</span>
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton
              label="Search"
              hint="⌘F"
              onClick={() => {
                setSearching(s => !s);
                window.setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <MagnifyingGlass />
            </IconButton>
            {menu}
          </div>
        </header>

        {searching && (
          <div className="flex shrink-0 items-center gap-2 border-b px-3 pb-2">
            <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search every page"
              className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => {
                setQuery('');
                setSearching(false);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {snap.error && (
          <div className="shrink-0 bg-destructive/15 px-3 py-2 text-xs text-destructive">
            {snap.error}
            {snap.read_only && ' Nothing is being saved until this is resolved.'}
          </div>
        )}

        {notice}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {rows.length === 0 && doneCount === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {query ? (
                'Nothing matches.'
              ) : (
                <>
                  Select text anywhere and tap <Kbd>Shift</Kbd> twice.
                </>
              )}
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rows.map(r => r.item.id)}
                strategy={verticalListSortingStrategy}
              >
                {rows.map((row, index) => (
                  <Fragment key={row.item.id}>
                    {row.item.done && !rows[index - 1]?.item.done && doneHeader}
                    <ItemRow
                      row={row}
                      showPage={Boolean(query)}
                      selected={selected.includes(row.item.id)}
                      editing={editing === row.item.id}
                      onEdit={() => setEditing(row.item.id)}
                      onWarn={toast}
                      onEndEdit={() => setEditing(null)}
                      onClick={e => selectRow(index, e)}
                      selectionCount={selected.length}
                      onCopy={() =>
                        copySelection(selected.includes(row.item.id) ? selected : [row.item.id])
                      }
                      onMerge={() => void store.mergeItems(selected)}
                      onDelete={() =>
                        void store.deleteItems(
                          selected.includes(row.item.id) ? selected : [row.item.id],
                        )
                      }
                      // Search shows rows from several pages, where "drop
                      // above this row" has no one meaning, so dragging is off
                      // there. Editing needs the pointer for text selection.
                      canDrag={!query && editing !== row.item.id}
                    />
                  </Fragment>
                ))}
                {/* Collapsed done rows are not in `rows`, so the heading
                    has no row to sit above and goes at the end instead. */}
                {doneCollapsed && doneHeader}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {selected.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 border-t px-2 py-1.5 text-xs">
            <span className="px-1 text-muted-foreground">{selected.length} selected</span>
            <div className="ml-auto flex items-center gap-0.5">
              <Button variant="ghost" size="sm" onClick={() => copySelection()}>
                <Copy /> Copy as list <Kbd>⌘⇧C</Kbd>
              </Button>
              {/* A mixed selection checks everything rather than flipping each
                item, which would only swap the mix around. */}
              <IconButton
                label={allSelectedDone ? 'Unmark done' : 'Mark done'}
                onClick={() => void store.setDone(selected, !allSelectedDone)}
              >
                {allSelectedDone ? <Square /> : <CheckSquare />}
              </IconButton>
              {selected.length > 1 && (
                <IconButton
                  label="Merge into one item"
                  onClick={() => void store.mergeItems(selected)}
                >
                  <ArrowsMerge />
                </IconButton>
              )}
              <IconButton label="Delete" hint="⌫" onClick={() => void store.deleteItems(selected)}>
                <Trash />
              </IconButton>
            </div>
          </div>
        )}

        <div className="shrink-0 border-t p-2">
          <textarea
            ref={composerRef}
            rows={1}
            placeholder="Next prompt"
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-40 w-full resize-none rounded-lg bg-muted/50 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
          />
        </div>

        <PagePalette
          open={palette}
          onOpenChange={setPalette}
          pages={snap.pages}
          active={snap.active}
          onPick={name => void store.setActive(name)}
          onRename={(from, to) => void store.renamePage(from, to)}
          onDelete={name => void store.deletePage(name)}
        />

        {flash && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-full bg-foreground px-2.5 py-1 text-xs text-background shadow">
              {flash}
            </span>
          </div>
        )}
      </Panel>
    </TooltipProvider>
  );
}

function IconButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" onClick={onClick} />}
        aria-label={label}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hint && <Kbd>{hint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

type RowProps = {
  row: Row;
  showPage: boolean;
  selected: boolean;
  editing: boolean;
  selectionCount: number;
  onEdit: () => void;
  onEndEdit: () => void;
  onWarn: (message: string) => void;
  onClick: (e: React.MouseEvent) => void;
  onCopy: () => void;
  onMerge: () => void;
  onDelete: () => void;
  canDrag: boolean;
};

function ItemRow({
  row,
  showPage,
  selected,
  editing,
  selectionCount,
  onEdit,
  onEndEdit,
  onWarn,
  onClick,
  onCopy,
  onMerge,
  onDelete,
  canDrag,
}: RowProps) {
  const store = useStore();
  const { item } = row;
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({
    id: item.id,
    disabled: !canDrag,
  });
  const editRef = useRef<HTMLParagraphElement>(null);
  // Esc discards, so it asks once before throwing typing away.
  const discardArmed = useRef(false);

  useEffect(() => {
    const el = editRef.current;
    if (!editing || !el) return;
    discardArmed.current = false;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            {...listeners}
            onClick={onClick}
            onDoubleClick={onEdit}
            className={cn(
              'flex cursor-default gap-2 rounded-md px-2 py-1.5',
              selected ? 'bg-accent shadow-[inset_2px_0_0_0_var(--primary)]' : 'hover:bg-accent/50',
              // The row itself follows the pointer, so lift it above its
              // neighbours while it travels across them.
              isDragging && 'relative z-10 bg-accent shadow-md',
            )}
          />
        }
      >
        <Checkbox
          checked={item.done}
          onCheckedChange={() => void store.toggleItem(item.id)}
          onClick={e => e.stopPropagation()}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p
            ref={editRef}
            contentEditable={editing}
            suppressContentEditableWarning
            onClick={e => editing && e.stopPropagation()}
            onBlur={e => {
              const text = e.currentTarget.innerText;
              if (text !== item.text) void store.updateItem(item.id, text);
              onEndEdit();
            }}
            onKeyDown={e => {
              if (e.key !== 'Escape') discardArmed.current = false;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                const el = e.currentTarget;
                if (el.innerText !== item.text && !discardArmed.current) {
                  discardArmed.current = true;
                  onWarn('Esc again to discard changes');
                  return;
                }
                el.innerText = item.text;
                el.blur();
              }
            }}
            className={cn(
              'text-sm break-words whitespace-pre-wrap',
              item.done && !editing && 'text-muted-foreground line-through',
              editing && '-mx-1 -my-0.5 rounded-sm px-1 py-0.5 outline-2 outline-ring',
            )}
          >
            {item.text}
          </p>
          {showPage && <span className="text-[11px] text-muted-foreground">{row.page}</span>}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onCopy}>
          Copy as list
          <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onEdit}>Edit</ContextMenuItem>
        {selectionCount > 1 && <ContextMenuItem onClick={onMerge}>Merge</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          Delete
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
