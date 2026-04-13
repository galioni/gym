import React from "react";
import { ArrowLeft } from "lucide-react";
import { TemplateEditor } from "../../../templates/components/TemplateEditor/TemplateEditor";
import { SyncSettingsPanel } from "../../../sync/components/SyncSettingsPanel/SyncSettingsPanel";
import { SessionOption, SessionType, TemplateData, Templates } from "../../../../types";
import { SyncConflict, SyncNowResult, SyncRestorePoint } from "../../../../application/sync/syncTypes";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import {
  CreateSessionTypeResult,
  DeleteSessionTypeResult,
  RenameSessionTypeResult,
} from "../../../../application/workout/sessionTypes/sessionTypeRules";

interface SettingsPageProps {
  onBack: () => void;
  templates: Templates;
  sessionOptions: SessionOption[];
  templateSaveError: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  syncMessage: string;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  isSyncing: boolean;
  onSaveSectionTemplate: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  onUndoSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onResetSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onCreateSessionType: (label: string) => Promise<CreateSessionTypeResult>;
  onDeleteSessionType: (sessionType: SessionType) => Promise<DeleteSessionTypeResult>;
  onRenameSessionType: (oldType: SessionType, newLabel: string) => Promise<RenameSessionTypeResult>;
  onSyncNow: (
    resolution?: Partial<Record<"workoutData" | "templates", "keepLocal" | "keepCloud">>
  ) => Promise<SyncNowResult>;
  onRollback: (id: string) => Promise<SyncNowResult>;
  onPruneRestorePoints: () => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  onBack,
  templates,
  sessionOptions,
  templateSaveError,
  lastSyncedAt,
  lastSyncError,
  syncMessage,
  conflicts,
  restorePoints,
  isSyncing,
  onSaveSectionTemplate,
  onUndoSectionTemplate,
  onResetSectionTemplate,
  onCreateSessionType,
  onDeleteSessionType,
  onRenameSessionType,
  onSyncNow,
  onRollback,
  onPruneRestorePoints,
}) => {
  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-5 sm:space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={16} />
        Back
      </button>
      <TemplateEditor
        templates={templates}
        sessionOptions={sessionOptions}
        saveError={templateSaveError}
        onSaveSection={onSaveSectionTemplate}
        onUndoSection={onUndoSectionTemplate}
        onResetSection={onResetSectionTemplate}
        onCreateSessionType={onCreateSessionType}
        onDeleteSessionType={onDeleteSessionType}
        onRenameSessionType={onRenameSessionType}
      />
      <SyncSettingsPanel
        lastSyncedAt={lastSyncedAt}
        lastError={lastSyncError}
        syncMessage={syncMessage}
        conflicts={conflicts}
        restorePoints={restorePoints}
        isSyncing={isSyncing}
        onSyncNow={onSyncNow}
        onRollback={onRollback}
        onPruneRestorePoints={onPruneRestorePoints}
      />
    </main>
  );
};
