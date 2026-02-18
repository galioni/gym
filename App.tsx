import React, { useMemo } from "react";
import { Header } from "./components/Header";
import { StickyFooter } from "./components/StickyFooter";
import { useWorkoutTracker } from "./features/workout/state/useWorkoutTracker";
import { getFridayHint } from "./utils";
import { QASmokePanel } from "./features/qa/components/QASmokePanel/QASmokePanel";
import { useTheme } from "./features/theme/hooks/useTheme";
import { useTemplates } from "./features/templates/state/useTemplates";
import { SessionType } from "./types";
import { createWorkoutServices } from "./infrastructure/workout/factory/createWorkoutServices";
import { useSyncSettings } from "./features/sync/state/useSyncSettings";
import { useWorkoutKeyboardShortcuts } from "./features/app-shell/hooks/useWorkoutKeyboardShortcuts";
import { DashboardContent } from "./features/app-shell/components/DashboardContent/DashboardContent";

function App() {
  const services = useMemo(() => createWorkoutServices(), []);
  const isQAMode = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return new URLSearchParams(window.location.search).get("qa") === "1";
  }, []);
  const { theme, setTheme } = useTheme();
  const {
    templates,
    isLoaded: areTemplatesLoaded,
    lastError: templateSaveError,
    saveSectionTemplate,
    undoSectionTemplate,
    resetSectionTemplate,
  } = useTemplates(services.templateService);

  const {
    currentDate,
    isLoaded,
    isSaving,
    currentDay,
    setCurrentDate,
    updateDay,
    updateDayDebounced,
    toggleItem,
    deleteItem,
    changeSessionType,
    resetFromTemplate,
    clearCurrentDay,
    jumpToToday,
    duplicatePreviousDayNotesAndWeight,
  } = useWorkoutTracker(services.workoutDataService, templates);
  const {
    settings: syncSettings,
    isSyncing,
    conflicts,
    restorePoints,
    syncMessage,
    setMode: setSyncMode,
    syncNow,
    rollbackToRestorePoint,
  } = useSyncSettings(services.syncService);

  const fridayHint = useMemo(() => getFridayHint(currentDate), [currentDate]);

  useWorkoutKeyboardShortcuts({
    onJumpToday: jumpToToday,
    onResetFromTemplate: resetFromTemplate,
    onDuplicatePreviousDayNotesAndWeight: duplicatePreviousDayNotesAndWeight,
  });

  if (!isLoaded || !areTemplatesLoaded) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-slate-200">
      <Header
        currentDate={currentDate}
        onDateChange={(event) => setCurrentDate(event.target.value)}
        sessionType={currentDay.sessionType}
        onSessionTypeChange={(event) => changeSessionType(event.target.value as SessionType)}
        onLoadTemplate={() => {
          if (confirm("This will overwrite the current list items. Continue?")) {
            resetFromTemplate();
          }
        }}
        onJumpToday={jumpToToday}
        theme={theme}
        onThemeChange={setTheme}
      />

      <DashboardContent
        fridayHint={fridayHint}
        currentDay={currentDay}
        templates={templates}
        templateSaveError={templateSaveError}
        syncMode={syncSettings.mode}
        lastSyncedAt={syncSettings.lastSyncedAt}
        lastSyncError={syncSettings.lastError}
        syncMessage={syncMessage}
        conflicts={conflicts}
        restorePoints={restorePoints}
        isSyncing={isSyncing}
        onToggleItem={toggleItem}
        onDeleteItem={deleteItem}
        onUpdateDay={updateDay}
        onUpdateDayDebounced={updateDayDebounced}
        onDuplicatePreviousDayNotesAndWeight={duplicatePreviousDayNotesAndWeight}
        onSaveSectionTemplate={saveSectionTemplate}
        onUndoSectionTemplate={undoSectionTemplate}
        onResetSectionTemplate={resetSectionTemplate}
        onSyncModeChange={setSyncMode}
        onSyncNow={(resolution) => syncNow(resolution).then(() => undefined)}
        onRollbackSyncPoint={(id) => rollbackToRestorePoint(id).then(() => undefined)}
      />

      <StickyFooter
        day={currentDay}
        isSaving={isSaving}
        onClear={() => {
          if (confirm("Are you sure you want to clear all data for this day?")) {
            clearCurrentDay();
          }
        }}
      />

      {isQAMode && <QASmokePanel />}
    </div>
  );
}

export default App;
