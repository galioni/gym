import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { SessionOption, SessionType, TemplateData, Templates } from "../../../../types";
import { generateId } from "../../../../utils";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import { useFeedback } from "../../../feedback/hooks/useFeedback";
import {
  CreateSessionTypeResult,
  DeleteSessionTypeResult,
  RenameSessionTypeResult,
  isBuiltInSessionType,
} from "../../../../application/workout/sessionTypes/sessionTypeRules";
import { TemplateRowList } from "./TemplateRowList";

interface TemplateEditorProps {
  templates: Templates;
  sessionOptions: SessionOption[];
  saveError: string | null;
  onSaveSection: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  onUndoSection: (session: SessionType, section: keyof TemplateData) => void;
  onResetSection: (session: SessionType, section: keyof TemplateData) => void;
  onCreateSessionType: (label: string) => Promise<CreateSessionTypeResult>;
  onRenameSessionType: (oldType: SessionType, newLabel: string) => Promise<RenameSessionTypeResult>;
  onDeleteSessionType: (sessionType: SessionType) => Promise<DeleteSessionTypeResult>;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  templates,
  sessionOptions,
  saveError,
  onSaveSection,
  onUndoSection,
  onResetSection,
  onCreateSessionType,
  onRenameSessionType,
  onDeleteSessionType,
}) => {
  const { showToast } = useFeedback();
  const [session, setSession] = useState<SessionType>(sessionOptions[0]?.value ?? "gym");
  const [section, setSection] = useState<keyof TemplateData>("main");
  const [rows, setRows] = useState<TemplateData[keyof TemplateData]>([]);
  const [errors, setErrors] = useState<TemplateValidationError[]>([]);
  const previousSaveErrorRef = useRef<string | null>(null);

  // New session form
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const newLabelRef = useRef<HTMLInputElement>(null);

  // Rename form
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameLabel, setRenameLabel] = useState("");
  const renameLabelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sessionOptions.some((option) => option.value === session)) {
      return;
    }
    if (sessionOptions[0]?.value) {
      setSession(sessionOptions[0].value);
    }
  }, [session, sessionOptions]);

  const sectionRows = useMemo(
    () => templates[session]?.[section] ?? [],
    [templates, session, section]
  );

  useEffect(() => {
    setRows(sectionRows.map((row) => ({ ...row })));
    setErrors([]);
  }, [sectionRows]);

  useEffect(() => {
    if (saveError && saveError !== previousSaveErrorRef.current) {
      showToast({ tone: "error", title: "Template save failed", description: saveError });
    }
    previousSaveErrorRef.current = saveError;
  }, [saveError, showToast]);

  useEffect(() => {
    if (isCreating) newLabelRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (isRenaming) renameLabelRef.current?.focus();
  }, [isRenaming]);

  const handleSave = () => {
    const validationErrors = onSaveSection(session, section, rows);
    setErrors(validationErrors);
    if (validationErrors.length > 0) {
      showToast({ tone: "error", title: validationErrors[0].message });
      return;
    }
    showToast({ tone: "success", title: "Template saved" });
  };

  const handleCreateSubmit = async () => {
    if (isSubmittingCreate || newLabel.trim().length === 0) return;
    setIsSubmittingCreate(true);
    const result = await onCreateSessionType(newLabel.trim());
    if (result.status === "success") {
      showToast({ tone: "success", title: result.message });
      if (result.sessionType) setSession(result.sessionType);
      setNewLabel("");
      setIsCreating(false);
    } else {
      showToast({ tone: "error", title: result.message });
    }
    setIsSubmittingCreate(false);
  };

  const handleRenameSubmit = async () => {
    if (renameLabel.trim().length === 0) return;
    const result = await onRenameSessionType(session, renameLabel.trim());
    if (result.status === "success") {
      showToast({ tone: "success", title: result.message });
      if (result.newSessionType) setSession(result.newSessionType);
      setIsRenaming(false);
      setRenameLabel("");
    } else {
      showToast({ tone: "error", title: result.message });
    }
  };

  const handleDeleteSession = async () => {
    const result = await onDeleteSessionType(session);
    if (result.status === "success") {
      showToast({ tone: "success", title: result.message });
    } else if (result.message !== "Cancelled.") {
      showToast({ tone: "error", title: result.message });
    }
  };

  const isCustomSession = !isBuiltInSessionType(session);
  const currentOption = sessionOptions.find((o) => o.value === session);

  return (
    <Card className="motion-rise" title="Session Templates">

      {/* Session selector row */}
      <div className="flex items-center gap-2 mb-4">
        {isRenaming ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              ref={renameLabelRef}
              type="text"
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameSubmit();
                if (e.key === "Escape") { setIsRenaming(false); setRenameLabel(""); }
              }}
              placeholder="Session name"
              className="flex-1 bg-background/70 border border-primary/40 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              onClick={() => void handleRenameSubmit()}
              disabled={renameLabel.trim().length === 0}
              className="text-primary hover:text-white disabled:opacity-40 transition-colors"
              title="Confirm rename"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={() => { setIsRenaming(false); setRenameLabel(""); }}
              className="text-slate-500 hover:text-slate-300 transition-colors"
              title="Cancel"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            <select
              value={session}
              onChange={(e) => {
                setSession(e.target.value as SessionType);
                setIsCreating(false);
              }}
              className="flex-1 bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
            >
              {sessionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {isCustomSession && (
              <>
                <button
                  type="button"
                  onClick={() => { setIsRenaming(true); setRenameLabel(currentOption?.label ?? ""); }}
                  className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                  title="Rename session type"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteSession()}
                  className="text-slate-500 hover:text-red-400 transition-colors p-1"
                  title="Delete session type"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setIsCreating((v) => !v)}
              className={`flex items-center gap-1 px-3 py-2 rounded-xl border text-sm transition-colors ${
                isCreating
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/30"
              }`}
              title="Add new session type"
            >
              <Plus size={14} />
              New
            </button>
          </>
        )}
      </div>

      {/* New session inline form */}
      {isCreating && !isRenaming && (
        <div className="flex items-center gap-2 mb-4">
          <input
            ref={newLabelRef}
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateSubmit();
              if (e.key === "Escape") { setIsCreating(false); setNewLabel(""); }
            }}
            placeholder="e.g. Morning Yoga"
            className="flex-1 bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-primary/50"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleCreateSubmit()}
            disabled={isSubmittingCreate || newLabel.trim().length === 0}
          >
            Create
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setIsCreating(false); setNewLabel(""); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Section tabs + secondary actions */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex gap-1">
          {(["warmup", "main"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                section === s ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {s === "warmup" ? "Warm-up" : "Main"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              onUndoSection(session, section);
              showToast({ tone: "info", title: "Last change undone" });
            }}
          >
            <Undo2 size={13} />
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              onResetSection(session, section);
              showToast({ tone: "info", title: "Section reset to defaults" });
            }}
          >
            <RotateCcw size={13} />
            Reset
          </Button>
        </div>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-red-200">
          {errors[0].message}
        </div>
      )}

      {/* Exercise list */}
      <TemplateRowList section={section} rows={rows} onRowsChange={setRows} />

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => setRows((prev) => [...prev, { id: generateId(), text: "", target: "" }])}
        >
          <Plus size={14} />
          Add Exercise
        </Button>
        <Button variant="primary" size="sm" className="gap-2" onClick={handleSave}>
          <Save size={14} />
          Save
        </Button>
      </div>
    </Card>
  );
};
