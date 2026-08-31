import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { ArrowRight, Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Section } from "@/lib/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: Section[];
  active: string;
  onPick: (name: string) => void;
};

export function SectionPalette({ open, onOpenChange, sections, active, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections.filter((s) => s.name.toLowerCase().includes(q));
  }, [sections, query]);

  // Offer to create the section only when nothing already has that exact name.
  const creating =
    query.trim().length > 0 && !sections.some((s) => s.name === query.trim());
  const rows = creating ? [...matches, null] : matches;

  const commit = (index: number) => {
    const row = rows[index];
    onPick(row ? row.name : query.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-20 max-w-[calc(100vw-2rem)] translate-y-0 gap-0 p-0"
      >
        <DialogTitle className="sr-only">Switch section</DialogTitle>
        <input
          autoFocus
          value={query}
          placeholder="Go to or create a section"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter" && rows.length > 0) {
              e.preventDefault();
              commit(cursor);
            }
          }}
          className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-64 overflow-y-auto border-t p-1">
          {rows.map((row, i) => (
            <button
              key={row ? row.name : "__new"}
              onMouseEnter={() => setCursor(i)}
              onClick={() => commit(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                i === cursor && "bg-accent text-accent-foreground",
              )}
            >
              {row ? (
                <>
                  <ArrowRight className="size-3.5 opacity-50" />
                  <span className="truncate">{row.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {row.items.length}
                  </span>
                  {row.name === active && <Kbd className="ml-1">now</Kbd>}
                </>
              ) : (
                <>
                  <Plus className="size-3.5 opacity-50" />
                  <span className="truncate">Create "{query.trim()}"</span>
                </>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
