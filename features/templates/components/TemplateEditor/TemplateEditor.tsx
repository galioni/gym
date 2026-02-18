import React, { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import {
  SESSION_OPTIONS,
  TEMPLATE_TARGET_MAX_LENGTH,
  TEMPLATE_TEXT_MAX_LENGTH,
} from "../../../../constants";
import { SessionType, TemplateData, Templates } from "../../../../types";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";

interface TemplateEditorProps {
  templates: Templates;
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
  onSaveSection,
  onUndoSection,
  onResetSection,
}) => {
  const [session, setSession] = useState<SessionType>("gym");
  const [section, setSection] = useState<keyof TemplateData>("main");
  const [rows, setRows] = useState<TemplateData[keyof TemplateData]>([]);
  const [errors, setErrors] = useState<TemplateValidationError[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const sectionRows = useMemo(() => templates[session][section], [templates, session, section]);

  useEffect(() => {
    setRows(sectionRows.map((row) => ({ ...row })));
    setErrors([]);
  }, [sectionRows]);

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
          className="gap-2"
          onClick={() => {
            const validationErrors = onSaveSection(session, section, rows);
            setErrors(validationErrors);
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
          className="gap-2"
          onClick={() => setRows((previous) => [...previous, { text: "", target: "" }])}
        >
          <Plus size={14} />
          Add Exercise
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => onUndoSection(session, section)}>
          Undo
        </Button>
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => onResetSection(session, section)}>
          Reset Section
        </Button>
      </div>

      {errors.length > 0 && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-red-200">
          {errors[0].message}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={`${section}-${index}`}
            className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 items-center"
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) {
                reorderRows(dragIndex, index);
              }
              setDragIndex(null);
            }}
          >
            <input
              type="text"
              value={row.text}
              onChange={(event) => handleRowChange(index, "text", event.target.value)}
              placeholder="Exercise"
              maxLength={TEMPLATE_TEXT_MAX_LENGTH}
              className="bg-background/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50"
            />
            <input
              type="text"
              value={row.target ?? ""}
              onChange={(event) => handleRowChange(index, "target", event.target.value)}
              placeholder="Target (e.g. 3x8-12)"
              maxLength={TEMPLATE_TARGET_MAX_LENGTH}
              className="bg-background/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button
              variant="ghost"
              size="icon"
              title="Remove row"
              onClick={() => setRows((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
};
