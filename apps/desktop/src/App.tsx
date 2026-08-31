import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsMerge,
  Copy,
  DotsThree,
  DotsThreeVertical,
  EyeSlash,
  FolderOpen,
  MagnifyingGlass,
  Power,
  ShieldCheck,
  Trash,
  X,
} from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, inTauri, on, type Item, type Snapshot } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionPalette } from "@/components/section-palette";

type Row = { item: Item; section: string };

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [palette, setPalette] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  // The panel has no title bar, so nothing else tells you whether typing will
  // land here or in the app behind it.
  const [focused, setFocused] = useState(true);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<number | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => setFocused(payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const toast = useCallback((message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash((f) => (f === message ? null : f)), 1600);
  }, []);

  useEffect(() => {
    api.snapshot().then(setSnap);
    const unlisten = [
      on<Snapshot>("notes", (e) => setSnap(e.payload)),
      on("captured", () => toast("Captured")),
      on("focus-input", () => composerRef.current?.focus()),
    ];
    return () => {
      unlisten.forEach((p) => p.then((f) => f()));
    };
  }, [toast]);

  // Searching looks across every section; otherwise you see the active one.
  const rows: Row[] = useMemo(() => {
    if (!snap) return [];
    const q = query.trim().toLowerCase();
    if (q) {
      return snap.sections.flatMap((s) =>
        s.items
          .filter((i) => i.text.toLowerCase().includes(q))
          .map((item) => ({ item, section: s.name })),
      );
    }
    const section = snap.sections.find((s) => s.name === snap.active);
    return (section?.items ?? []).map((item) => ({ item, section: snap.active }));
  }, [snap, query]);

  // A deleted item must not stay selected, or the toolbar lies about the count.
  useEffect(() => {
    const live = new Set(rows.map((r) => r.item.id));
    setSelected((prev) => {
      const next = prev.filter((id) => live.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  const selectRow = (index: number, e: React.MouseEvent) => {
    const id = rows[index].item.id;
    if (e.metaKey) {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      anchorRef.current = index;
      return;
    }
    if (e.shiftKey && anchorRef.current !== null) {
      const [from, to] = [anchorRef.current, index].sort((a, b) => a - b);
      setSelected(rows.slice(from, to + 1).map((r) => r.item.id));
      return;
    }
    setSelected([id]);
    anchorRef.current = index;
  };

  const copySelection = useCallback(
    async (ids = selected) => {
      if (ids.length === 0) return;
      await api.copyAsList(ids);
      toast(ids.length > 1 ? `Copied ${ids.length} as a list` : "Copied");
    },
    [selected, toast],
  );

  const submit = async () => {
    const value = composerRef.current?.value ?? "";
    const text = value.trim();
    if (!text) return;
    // `# Name` is how you make and switch sections, same as Copper.
    if (text.startsWith("# ")) {
      await api.setActive(text.slice(2).trim());
      setQuery("");
      setSearching(false);
    } else {
      await api.addItem(text);
    }
    if (composerRef.current) {
      composerRef.current.value = "";
      composerRef.current.style.height = "auto";
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);

      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void copySelection();
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearching(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        void api.quit();
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        void api.hideWindow();
        return;
      }
      if (e.metaKey && (e.key === "-" || e.key === "=" || e.key === "0")) {
        e.preventDefault();
        const zoom = snap?.zoom ?? 1;
        void api.setZoom(e.key === "0" ? 1 : zoom + (e.key === "-" ? -0.1 : 0.1));
        return;
      }
      if (e.key === "Escape") {
        if (editing !== null) return;
        if (query || searching) {
          setQuery("");
          setSearching(false);
        } else {
          setSelected([]);
        }
        return;
      }
      if (typing) return;

      if (e.metaKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(rows.map((r) => r.item.id));
      } else if (e.metaKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (selected.length > 1) void api.mergeItems(selected);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (selected.length > 0) void api.deleteItems(selected);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const current = anchorRef.current ?? (step > 0 ? -1 : rows.length);
        const next = Math.max(0, Math.min(rows.length - 1, current + step));
        if (rows[next]) {
          anchorRef.current = next;
          setSelected([rows[next].item.id]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, editing, query, rows, searching, selected, snap?.zoom]);

  if (!snap) return null;

  // Accessibility is the prerequisite, and Input Monitoring follows from it
  // without a prompt, so naming both at once would send people hunting for a
  // permission they never have to grant by hand.
  const missingPermission = !snap.trusted
    ? "Accessibility"
    : !snap.input_monitoring
      ? "Input Monitoring"
      : null;

  return (
    <TooltipProvider>
    <div
      className={cn(
        "flex h-screen flex-col overflow-hidden rounded-xl border bg-background/85 backdrop-blur-2xl transition-colors",
        focused ? "border-ring/80" : "border-border/30",
      )}
    >
      <header
        // The drag-region attribute only fires on the element under the
        // pointer, so the gaps between buttons were the only grabbable
        // pixels. Dragging from anywhere that is not a control is better.
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          if (inTauri) void getCurrentWindow().startDragging();
        }}
        className="flex shrink-0 cursor-grab items-center gap-1 px-3 py-2 active:cursor-grabbing"
      >
        <button
          onClick={() => setPalette(true)}
          className={cn(
            "truncate rounded-md px-1.5 py-0.5 text-sm font-medium hover:bg-accent",
            !focused && "text-muted-foreground",
          )}
          title="Switch section (⌘K)"
        >
          {snap.active}
        </button>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            label="Search"
            hint="⌘F"
            onClick={() => {
              setSearching((s) => !s);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            <MagnifyingGlass />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="More"
            >
              <DotsThreeVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56 [&_[data-slot=dropdown-menu-item]]:whitespace-nowrap">
              <DropdownMenuItem onClick={() => api.revealNotes()}>
                <FolderOpen /> Show notes.md in Finder
              </DropdownMenuItem>
              {missingPermission && (
                <DropdownMenuItem onClick={() => api.requestPermissions()}>
                  <ShieldCheck /> Grant {missingPermission}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => api.hideWindow()}>
                <EyeSlash /> Hide
                <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => api.quit()}>
                <Power /> Quit JogPad
                <DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {searching && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 pb-2">
          <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every section"
            className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={() => {
              setQuery("");
              setSearching(false);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {missingPermission && (
        <button
          onClick={() => api.requestPermissions()}
          className="shrink-0 bg-amber-500/15 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300"
        >
          Double-tap Shift needs {missingPermission}. Click to open Settings.
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {query ? (
              "Nothing matches."
            ) : (
              <>
                Select text anywhere and tap <Kbd>Shift</Kbd> twice.
              </>
            )}
          </p>
        ) : (
          rows.map((row, index) => (
            <ItemRow
              key={row.item.id}
              row={row}
              showSection={Boolean(query)}
              selected={selected.includes(row.item.id)}
              editing={editing === row.item.id}
              onEdit={() => setEditing(row.item.id)}
              onEndEdit={() => setEditing(null)}
              onClick={(e) => selectRow(index, e)}
              selectionCount={selected.length}
              onCopy={() => copySelection(selected.includes(row.item.id) ? selected : [row.item.id])}
              onMerge={() => api.mergeItems(selected)}
              onDelete={() =>
                api.deleteItems(
                  selected.includes(row.item.id) ? selected : [row.item.id],
                )
              }
            />
          ))
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 border-t px-2 py-1.5 text-xs">
          <span className="px-1 text-muted-foreground">{selected.length} selected</span>
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="sm" onClick={() => copySelection()}>
              <Copy /> Copy as list
            </Button>
            {selected.length > 1 && (
              <IconButton
                label="Merge into one item"
                hint="⌘M"
                onClick={() => api.mergeItems(selected)}
              >
                <ArrowsMerge />
              </IconButton>
            )}
            <IconButton label="Delete" hint="⌫" onClick={() => api.deleteItems(selected)}>
              <Trash />
            </IconButton>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t p-2">
        <textarea
          ref={composerRef}
          rows={1}
          placeholder="Next prompt, or # to switch section"
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className="max-h-40 w-full resize-none rounded-lg bg-muted/50 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted"
        />
      </div>

      <SectionPalette
        open={palette}
        onOpenChange={setPalette}
        sections={snap.sections}
        active={snap.active}
        onPick={(name) => api.setActive(name)}
      />

      {flash && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full bg-foreground px-2.5 py-1 text-xs text-background shadow">
            {flash}
          </span>
        </div>
      )}
    </div>
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
  showSection: boolean;
  selected: boolean;
  editing: boolean;
  selectionCount: number;
  onEdit: () => void;
  onEndEdit: () => void;
  onClick: (e: React.MouseEvent) => void;
  onCopy: () => void;
  onMerge: () => void;
  onDelete: () => void;
};

function ItemRow({
  row,
  showSection,
  selected,
  editing,
  selectionCount,
  onEdit,
  onEndEdit,
  onClick,
  onCopy,
  onMerge,
  onDelete,
}: RowProps) {
  const { item } = row;

  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={item.text}
        onBlur={(e) => {
          void api.updateItem(item.id, e.currentTarget.value);
          onEndEdit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onEndEdit();
          } else if (e.key === "Enter" && e.metaKey) {
            e.currentTarget.blur();
          }
        }}
        className="my-0.5 w-full resize-y rounded-md bg-muted px-2 py-1.5 text-sm outline-none"
        rows={Math.min(item.text.split("\n").length + 1, 10)}
      />
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            onClick={onClick}
            onDoubleClick={onEdit}
            className={cn(
              "group flex cursor-default gap-2 rounded-md px-2 py-1.5",
              selected
                ? "bg-accent shadow-[inset_2px_0_0_0_var(--primary)]"
                : "hover:bg-accent/50",
            )}
          />
        }
      >
        <Checkbox
          checked={item.done}
          onCheckedChange={() => api.toggleItem(item.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-sm break-words whitespace-pre-wrap",
              item.done && "text-muted-foreground line-through",
            )}
          >
            {item.text}
          </p>
          {showSection && (
            <span className="text-[11px] text-muted-foreground">{row.section}</span>
          )}
        </div>
        <DotsThree className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onCopy}>
          Copy as list
          <ContextMenuShortcut>⌘⇧C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onEdit}>Edit</ContextMenuItem>
        {selectionCount > 1 && (
          <ContextMenuItem onClick={onMerge}>
            Merge
            <ContextMenuShortcut>⌘M</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          Delete
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
