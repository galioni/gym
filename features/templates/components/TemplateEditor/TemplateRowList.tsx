import React, { useEffect, useState } from "react";
import { GripVertical, Trash2, AlertCircle } from "lucide-react";

const YOUTUBE_URL_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url);
}
import { Button } from "../../../../components/ui/Button";
import { TEMPLATE_TARGET_MAX_LENGTH, TEMPLATE_TEXT_MAX_LENGTH } from "../../../../constants";
import { TemplateData } from "../../../../types";
import { ExerciseLibraryEntry } from "../../../../application/workout/exerciseLibrary";
import { ExerciseInput } from "./ExerciseInput";

interface TemplateRowListProps {
  section: keyof TemplateData;
  rows: TemplateData[keyof TemplateData];
  onRowsChange: React.Dispatch<React.SetStateAction<TemplateData[keyof TemplateData]>>;
  library: ExerciseLibraryEntry[];
}

export const TemplateRowList: React.FC<TemplateRowListProps> = ({
  section,
  rows,
  onRowsChange,
  library,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const pointerMedia = window.matchMedia("(pointer: coarse)");
    const syncPointerMode = () => setIsCoarsePointer(pointerMedia.matches);
    syncPointerMode();
    if (typeof pointerMedia.addEventListener === "function") {
      pointerMedia.addEventListener("change", syncPointerMode);
      return () => pointerMedia.removeEventListener("change", syncPointerMode);
    }
    pointerMedia.addListener(syncPointerMode);
    return () => pointerMedia.removeListener(syncPointerMode);
  }, []);

  const handleRowChange = (index: number, field: "text" | "target" | "videoUrl", value: string) => {
    onRowsChange((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    );
  };

  const reorderRows = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    onRowsChange((previous) => {
      const next = [...previous];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div
          key={row.id ?? `${section}-${index}`}
          className="grid grid-cols-[auto_1fr_auto] gap-2 sm:grid-cols-[auto_2fr_1fr_auto] sm:items-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (isCoarsePointer) {
              return;
            }
            if (dragIndex !== null) {
              reorderRows(dragIndex, index);
            }
            setDragIndex(null);
          }}
        >
          <button
            type="button"
            draggable={!isCoarsePointer}
            onDragStart={() => {
              if (!isCoarsePointer) {
                setDragIndex(index);
              }
            }}
            onDragEnd={() => setDragIndex(null)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-background/40 text-slate-500 cursor-default sm:cursor-grab sm:active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            title="Drag to reorder"
            aria-label="Reorder row"
          >
            <GripVertical size={14} />
          </button>
          <ExerciseInput
            value={row.text}
            onChange={(text) => handleRowChange(index, "text", text)}
            onSelect={(entry) => {
              onRowsChange((prev) =>
                prev.map((r, ri) =>
                  ri === index
                    ? { ...r, text: entry.text, target: entry.target ?? r.target }
                    : r
                )
              );
            }}
            library={library}
            placeholder="Exercise"
            maxLength={TEMPLATE_TEXT_MAX_LENGTH}
            className="col-span-3 sm:col-span-1"
          />
          <input
            type="text"
            value={row.target ?? ""}
            onChange={(event) => handleRowChange(index, "target", event.target.value)}
            placeholder="Target (e.g. 3x8-12)"
            maxLength={TEMPLATE_TARGET_MAX_LENGTH}
            className="col-span-3 bg-background/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50 sm:col-span-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 p-0 col-start-3 row-start-1 justify-self-end rounded-lg sm:col-start-auto sm:row-start-auto sm:justify-self-auto"
            title="Remove row"
            onClick={() => onRowsChange((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}
          >
            <Trash2 size={13} />
          </Button>
          <div className="col-span-full flex flex-col gap-1">
            <input
              type="url"
              value={row.videoUrl ?? ""}
              onChange={(event) => handleRowChange(index, "videoUrl", event.target.value)}
              placeholder="YouTube URL (optional)"
              className={`w-full bg-background/60 border rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:ring-2 placeholder:text-slate-600 ${
                row.videoUrl && !isValidYouTubeUrl(row.videoUrl)
                  ? "border-red-500/60 focus:ring-red-500/40"
                  : "border-white/10 focus:ring-primary/50"
              }`}
            />
            {row.videoUrl && !isValidYouTubeUrl(row.videoUrl) && (
              <p className="flex items-center gap-1 text-xs text-red-400 pl-1">
                <AlertCircle size={11} />
                Must be a valid YouTube URL
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};