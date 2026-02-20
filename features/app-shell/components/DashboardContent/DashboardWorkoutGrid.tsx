import React from "react";
import { WorkoutSection } from "../../../../components/WorkoutSection";
import { RpeSelect } from "../../../workout/components/RpeSelect/RpeSelect";
import { DailyCheckCard } from "../../../workout/components/DailyCheckCard/DailyCheckCard";
import { TemplateEditor } from "../../../templates/components/TemplateEditor/TemplateEditor";
import { SyncSettingsPanel } from "../../../sync/components/SyncSettingsPanel/SyncSettingsPanel";
import { DayData, SessionType, TemplateData, Templates } from "../../../../types";
import { SyncConflict, SyncNowResult, SyncRestorePoint } from "../../../../application/sync/syncTypes";
import { TemplateValidationError } from "../../../../application/workout/templates/templateRules";

interface DashboardWorkoutGridProps {
  currentDay: DayData;
  templates: Templates;
  templateSaveError: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  syncMessage: string;
  conflicts: SyncConflict[];
  restorePoints: SyncRestorePoint[];
  isSyncing: boolean;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => Promise<boolean>;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
  onSaveSectionTemplate: (
    session: SessionType,
    section: keyof TemplateData,
    rows: TemplateData[keyof TemplateData]
  ) => TemplateValidationError[];
  onUndoSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onResetSectionTemplate: (session: SessionType, section: keyof TemplateData) => void;
  onSyncNow: (
    resolution?: Partial<Record<"workoutData" | "templates", "keepLocal" | "keepCloud">>
  ) => Promise<SyncNowResult>;
  onRollbackSyncPoint: (id: string) => Promise<SyncNowResult>;
}

export const DashboardWorkoutGrid: React.FC<DashboardWorkoutGridProps> = ({
  currentDay,
  templates,
  templateSaveError,
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
  onSaveSectionTemplate,
  onUndoSectionTemplate,
  onResetSectionTemplate,
  onSyncNow,
  onRollbackSyncPoint,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 pb-4">
      <div className="motion-rise motion-delay-1">
        <WorkoutSection
          title="Warm-up"
          items={currentDay.warmup}
          timerMs={currentDay.warmupTimerMs}
          notes={currentDay.warmupNotes}
          onToggleItem={(id, done) => onToggleItem("warmup", id, done)}
          onDeleteItem={(id) => onDeleteItem("warmup", id)}
          onUpdateTimer={(ms) => onUpdateDay({ warmupTimerMs: ms })}
          onUpdateNotes={(txt) => onUpdateDayDebounced({ warmupNotes: txt })}
        />
      </div>

      <div className="motion-rise motion-delay-2">
        <WorkoutSection
          title="Main Session"
          items={currentDay.main}
          timerMs={currentDay.mainTimerMs}
          notes={currentDay.mainNotes}
          onToggleItem={(id, done) => onToggleItem("main", id, done)}
          onDeleteItem={(id) => onDeleteItem("main", id)}
          onUpdateTimer={(ms) => onUpdateDay({ mainTimerMs: ms })}
          onUpdateNotes={(txt) => onUpdateDayDebounced({ mainNotes: txt })}
          headerExtra={<RpeSelect value={currentDay.rpe} onChange={(value) => onUpdateDay({ rpe: value })} />}
        />
      </div>

      <div className="md:hidden -mt-2 mb-1 flex justify-end">
        <RpeSelect mobile value={currentDay.rpe} onChange={(value) => onUpdateDay({ rpe: value })} />
      </div>

      <div className="md:col-span-2 motion-rise motion-delay-3">
        <DailyCheckCard
          day={currentDay}
          onUpdateField={(updates) => {
            if ("checkNotes" in updates && Object.keys(updates).length === 1) {
              onUpdateDayDebounced(updates);
              return;
            }
            onUpdateDay(updates);
          }}
        />
      </div>

      <div className="md:col-span-2 motion-rise">
        <TemplateEditor
          templates={templates}
          saveError={templateSaveError}
          onSaveSection={onSaveSectionTemplate}
          onUndoSection={onUndoSectionTemplate}
          onResetSection={onResetSectionTemplate}
        />
      </div>

      <div className="md:col-span-2 motion-rise">
        <SyncSettingsPanel
          lastSyncedAt={lastSyncedAt}
          lastError={lastSyncError}
          syncMessage={syncMessage}
          conflicts={conflicts}
          restorePoints={restorePoints}
          isSyncing={isSyncing}
          onSyncNow={onSyncNow}
          onRollback={onRollbackSyncPoint}
        />
      </div>
    </div>
  );
};
