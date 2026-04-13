import React from "react";
import { ArrowLeft, Download, Trash2, Upload } from "lucide-react";
import { TemplateEditor } from "../../../templates/components/TemplateEditor/TemplateEditor";
import { SyncSettingsPanel } from "../../../sync/components/SyncSettingsPanel/SyncSettingsPanel";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { SessionOption, SessionType, TemplateData, Templates } from "../../../../types";
import { SyncConflict, SyncNowResult, SyncRestorePoint } from "../../../../application/sync/syncTypes";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import {
  CreateSessionTypeResult,
  DeleteSessionTypeResult,
  RenameSessionTypeResult,
} from "../../../../application/workout/sessionTypes/sessionTypeRules";
import { useBackupIO } from "../../../session-controls/hooks/useBackupIO";
import { useAuthSession } from "../../../auth/hooks/useAuthSession";
import { useFeedback } from "../../../feedback/hooks/useFeedback";
import { APP_THEME_OPTIONS, AppTheme } from "../../../theme/constants/themeOptions";
import { WeightReminderSettings } from "../../../weight-reminder/hooks/useWeightReminder";
import {
  STORAGE_KEY,
  SYNC_RESTORE_POINTS_STORAGE_KEY,
  SYNC_SETTINGS_STORAGE_KEY,
  TEMPLATE_STORAGE_KEY,
} from "../../../../constants";

interface SettingsPageProps {
  onBack: () => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  weightReminder: WeightReminderSettings;
  onUpdateWeightReminder: (updates: Partial<WeightReminderSettings>) => void;
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
  theme,
  onThemeChange,
  weightReminder,
  onUpdateWeightReminder,
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
  const { fileInputRef, exportBackup, openImportPicker, handleImportFileChange } = useBackupIO();
  const { signOut } = useAuthSession();
  const { confirm, showToast } = useFeedback();

  const handleDeleteAllData = async () => {
    const confirmed = await confirm({
      title: "Delete all data?",
      description:
        "This permanently removes all your workout history, templates, and sync settings from this device. You will be signed out. This cannot be undone.",
      confirmLabel: "Delete everything",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TEMPLATE_STORAGE_KEY);
    localStorage.removeItem(SYNC_SETTINGS_STORAGE_KEY);
    localStorage.removeItem(SYNC_RESTORE_POINTS_STORAGE_KEY);

    showToast({ tone: "info", title: "All local data deleted" });
    await signOut();
  };

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

      {/* Reminders */}
      <Card title="Reminders">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-slate-300">Friday weight check</div>
              <div className="text-xs text-slate-500 mt-0.5">Banner shown on Fridays from midnight until the target time</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={weightReminder.enabled}
              onClick={() => onUpdateWeightReminder({ enabled: !weightReminder.enabled })}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                weightReminder.enabled ? "bg-primary" : "bg-white/20"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
                  weightReminder.enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {weightReminder.enabled && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Target time</span>
              <input
                type="time"
                value={weightReminder.targetTime}
                onChange={(e) => onUpdateWeightReminder({ targetTime: e.target.value })}
                className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Appearance */}
      <Card title="Appearance">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">Theme</span>
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as AppTheme)}
            className="bg-background/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
          >
            {APP_THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* Data */}
      <Card title="Data">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="secondary" size="sm" className="gap-2 flex-1 justify-center" onClick={exportBackup}>
              <Download size={14} />
              Export Backup
            </Button>
            <Button variant="secondary" size="sm" className="gap-2 flex-1 justify-center" onClick={openImportPicker}>
              <Upload size={14} />
              Import Backup
            </Button>
          </div>

          <div className="pt-2 border-t border-white/10">
            <Button
              variant="danger"
              size="sm"
              className="w-full gap-2 justify-center"
              onClick={() => void handleDeleteAllData()}
            >
              <Trash2 size={14} />
              Delete all data
            </Button>
            <p className="mt-2 text-xs text-slate-500 text-center">
              Removes all local workout history, templates, and sync settings. You will be signed out.
            </p>
          </div>
        </div>
      </Card>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFileChange}
        accept=".json"
        className="hidden"
      />
    </main>
  );
};
