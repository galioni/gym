import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save } from "lucide-react";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { SessionOption, SessionType, TemplateData, Templates } from "../../../../types";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import { useFeedback } from "../../../feedback/hooks/useFeedback";
import { CreateSessionTypeResult } from "../../../../application/workout/sessionTypes/sessionTypeRules";
import { SessionTypeCreateForm } from "./SessionTypeCreateForm";
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
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  templates,
  sessionOptions,
  saveError,
  onSaveSection,
  onUndoSection,
  onResetSection,
  onCreateSessionType,
}) => {
  const { showToast } = useFeedback();
  const [session, setSession] = useState<SessionType>(sessionOptions[0]?.value ?? "gym");
  const [section, setSection] = useState<keyof TemplateData>("main");
  const [rows, setRows] = useState<TemplateData[keyof TemplateData]>([]);
  const [errors, setErrors] = useState<TemplateValidationError[]>([]);
  const previousSaveErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionOptions.some((option) => option.value === session)) {
      return;
    }
    if (sessionOptions[0]?.value) {
      setSession(sessionOptions[0].value);
    }
  }, [session, sessionOptions]);

  const sectionRows = useMemo(() => templates[session]?.[section] ?? [], [templates, session, section]);

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

  const toastCreateResult = (result: CreateSessionTypeResult) => {
    if (result.status === "success") {
      showToast({ tone: "success", title: result.message });
      return;
    }

    showToast({ tone: "error", title: result.message });
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
          {sessionOptions.map((option) => (
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
        <SessionTypeCreateForm
          onCreateSessionType={onCreateSessionType}
          onCreated={setSession}
          onShowMessage={toastCreateResult}
        />
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

      <TemplateRowList section={section} rows={rows} onRowsChange={setRows} />
    </Card>
  );
};