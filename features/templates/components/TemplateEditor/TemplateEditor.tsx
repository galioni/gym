import React, { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import {
  SESSION_OPTIONS,
  TEMPLATE_TARGET_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
} from "../../../../constants";
import { SessionType, TemplateData, Templates } from "../../../../types";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import { useFeedback } from "../../../feedback/hooks/useFeedback";

interface TemplateEditorProps {
  templates: Templates;
  saveError: string | null;
  onSaveSection: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  onUndoSection: (session: SessionType, section: keyof TemplateData) => void;
  onResetSection: (session: SessionType, section: keyof TemplateData) => void;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  templates,
  saveError,
  onSaveSection,
  onUndoSection,
  onResetSection,
}) => {
  const { showToast } = useFeedback();
  const [session, setSession] = useState<SessionType>("gym");
  const [section, setSection] = useState<keyof TemplateData>("main");
  const [rows, setRows] = useState<TemplateData[keyof TemplateData]>([]);
  const [errors, setErrors] = useState<TemplateValidationError[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const previousSaveErrorRef = useRef<string | null>(null);

  const sectionRows = useMemo(() => templates[session][section], [templates, session, section]);

  useEffect(() => {
    setRows(sectionRows.map((row) => ({ ...row })));
    setErrors([]);
  }, [sectionRows]);

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

  useEffect(() => {
    if (saveError && saveError !== previousSaveErrorRef.current) {
      showToast({ tone: "error", title: "Template save failed", description: saveError });
    }
    previousSaveErrorRef.current = saveError;
  }, [saveError, showToast]);

  const handleRowChange = (index: number, field: "text" | "target", value: string) => {
    setRows((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    );
  };

  const reorderRows = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }
    setRows((previous) => {
      const next = [...previous];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  return (
    <Card
      className="motion-rise"
      title="Template Editor"
      headerAction={
        <Button
          variant="primary"
          size="sm"
          className="min-h-11 gap-2"
          onClick={() => {
            const validationErrors = onSaveSection(session, section, rows);
            setErrors(validationErrors);
            if (validationErrors.length > 0) {
              showToast({ tone: "error", title: validationErrors[0].message });
              return;
            }
            showToast({ tone: "success", title: "Template section saved" });
          }}
        >
          <Save size={14} />
          Save Section
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <select
          value={session}
          onChange={(event) => setSession(event.target.value as SessionType)}
          className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
        >
          {SESSION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={section}
          onChange={(event) => setSection(event.target.value as keyof TemplateData)}
          className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
        >
          <option value="warmup">Warm-up</option>
          <option value="main">Main</option>
        </select>
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 gap-2"
          onClick={() => setRows((previous) => [...previous, { text: "", target: "" }])}
        >
          <Plus size={14} />
          Add Exercise
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 gap-2"
          onClick={() => {
            onUndoSection(session, section);
            showToast({ tone: "info", title: "Last template change undone" });
          }}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 gap-2"
          onClick={() => {
            onResetSection(session, section);
            showToast({ tone: "info", title: "Template section reset to defaults" });
          }}
        >
          Reset Section
        </Button>
      </div>

      {errors.length > 0 && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-red-200">
          {errors[0].message}
        </div>
      )}
      {saveError && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-red-200">
          {saveError}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={`${section}-${index}`}
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
            <input
              type="text"
              value={row.text}
              onChange={(event) => handleRowChange(index, "text", event.target.value)}
              placeholder="Exercise"
              maxLength={TEMPLATE_TEXT_MAX_LENGTH}
              className="col-span-3 bg-background/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50 sm:col-span-1"
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
              onClick={() => setRows((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
};
