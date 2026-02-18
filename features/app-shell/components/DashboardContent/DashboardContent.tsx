import React from "react";
import { Button } from "../../../../components/ui/Button";
import { InfoBanner } from "../InfoBanner/InfoBanner";
import { DayData, SessionType, TemplateData, Templates } from "../../../../types";
import { SyncConflict, SyncRestorePoint } from "../../../../application/sync/syncTypes";
import { SyncMode } from "../../../../interfaces/sync/SyncSettingsRepository";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";
import { DashboardWorkoutGrid } from "./DashboardWorkoutGrid";

interface DashboardContentProps {
  fridayHint: string;
  currentDay: DayData;
  templates: Templates;
  templateSaveError: string | null;
  syncMode: SyncMode;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  syncMessage: string;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  isSyncing: boolean;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => void;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
  onDuplicatePreviousDayNotesAndWeight: () => boolean;
  onSaveSectionTemplate: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  onUndoSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onResetSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onSyncModeChange: (mode: SyncMode) => Promise<void>;
  onSyncNow: (
    resolution?: Partial<Record<"workoutData" | "templates", "keepLocal" | "keepCloud">>
  ) => Promise<void>;
  onRollbackSyncPoint: (id: string) => Promise<void>;
}

export const DashboardContent: React.FC<DashboardContentProps> = ({
  fridayHint,
  currentDay,
  templates,
  templateSaveError,
  syncMode,
  lastSyncedAt,
  lastSyncError,
  syncMessage,
  conflicts,
  restorePoints,
  isSyncing,
  onToggleItem,
  onDeleteItem,
  onUpdateDay,
  onUpdateDayDebounced,
  onDuplicatePreviousDayNotesAndWeight,
  onSaveSectionTemplate,
  onUndoSectionTemplate,
  onResetSectionTemplate,
  onSyncModeChange,
  onSyncNow,
  onRollbackSyncPoint,
}) => {
  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <InfoBanner content={fridayHint} />

      <div className="flex items-center justify-end gap-2 motion-rise">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const duplicated = onDuplicatePreviousDayNotesAndWeight();
            if (!duplicated) {
              alert("No previous day data found to duplicate.");
            }
          }}
        >
          Duplicate Prev Notes/Weight
        </Button>
      </div>

      <DashboardWorkoutGrid
        currentDay={currentDay}
        templates={templates}
        templateSaveError={templateSaveError}
        syncMode={syncMode}
        lastSyncedAt={lastSyncedAt}
        lastSyncError={lastSyncError}
        syncMessage={syncMessage}
        conflicts={conflicts}
        restorePoints={restorePoints}
        isSyncing={isSyncing}
        onToggleItem={onToggleItem}
        onDeleteItem={onDeleteItem}
        onUpdateDay={onUpdateDay}
        onUpdateDayDebounced={onUpdateDayDebounced}
        onSaveSectionTemplate={onSaveSectionTemplate}
        onUndoSectionTemplate={onUndoSectionTemplate}
        onResetSectionTemplate={onResetSectionTemplate}
        onSyncModeChange={onSyncModeChange}
        onSyncNow={onSyncNow}
        onRollbackSyncPoint={onRollbackSyncPoint}
      />
    </main>
  );
};
