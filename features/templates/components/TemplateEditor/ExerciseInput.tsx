import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExerciseLibraryEntry } from "../../../../application/workout/exerciseLibrary";
import { cn } from "../../../../utils";

interface ExerciseInputProps {
  value: string;
  onChange: (text: string) => void;
  onSelect: (entry: ExerciseLibraryEntry) => void;
  library: ExerciseLibraryEntry[];
  placeholder?: string;
  maxLength?: number;
  /** Applied to the wrapper div — use for grid column placement. */
  className?: string;
}

export function ExerciseInput({
  value,
  onChange,
  onSelect,
  library,
  placeholder,
  maxLength,
  className,
}: ExerciseInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const suggestions = useMemo<ExerciseLibraryEntry[]>(() => {
    const q = value.trim().toLowerCase();
    if (!q || library.length === 0) return [];
    const matches = library.filter((e) => {
      const t = e.text.toLowerCase();
      return t !== q && t.includes(q);
    });
    // Starts-with matches first, then contains; alphabetical within each group.
    matches.sort((a, b) => {
      const as = a.text.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.text.toLowerCase().startsWith(q) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.text.localeCompare(b.text);
    });
    return matches.slice(0, 8);
  }, [value, library]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll active item into view.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      onSelect(suggestions[activeIndex]);
      setOpen(false);
      setActiveIndex(-1);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (value.trim()) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full bg-background/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50"
      />
      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 top-full left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-surface border border-white/15 rounded-xl shadow-2xl shadow-black/40"
        >
          {suggestions.map((entry, i) => (
            <li key={entry.text} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(entry);
                  setOpen(false);
                  setActiveIndex(-1);
                }}
                className={cn(
                  "w-full text-left flex items-baseline gap-2 px-3 py-2 text-sm transition-colors",
                  i === activeIndex
                    ? "bg-primary/20 text-white"
                    : "text-slate-200 hover:bg-white/5"
                )}
              >
                <span className="truncate">{entry.text}</span>
                {entry.target && (
                  <span className="shrink-0 text-xs text-slate-500">{entry.target}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
