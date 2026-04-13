import React, { useCallback, useMemo, useState } from "react";
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
import { SettingsPage } from "./features/settings/components/SettingsPage/SettingsPage";
import { useFeedback } from "./features/feedback/hooks/useFeedback";
import { getSessionLabel, getSessionOptions } from "./application/workout/sessionTypes/sessionTypeRules";
import { useWeightReminder } from "./features/weight-reminder/hooks/useWeightReminder";

function App() {
  const { confirm, showToast } = useFeedback();
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
    addSessionType,
    removeSessionType,
    renameSessionType,
  } = useTemplates(services.templateService);

  const {
    currentDate,
    isLoaded,
    isSaving,
    currentDay,
    usedSessionTypes,
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
    syncNow,
    rollbackToRestorePoint,
    pruneRestorePoints,
  } = useSyncSettings(services.syncService);

  const sessionOptions = useMemo(() => getSessionOptions(templates), [templates]);
  const { settings: weightReminder, updateSettings: updateWeightReminder } = useWeightReminder();
  const fridayHint = useMemo(
    () => getFridayHint(weightReminder.enabled, weightReminder.targetTime),
    [weightReminder.enabled, weightReminder.targetTime]
  );
  const [stickyFooterHeight, setStickyFooterHeight] = useState(124);
  const [page, setPage] = useState<"dashboard" | "settings">("dashboard");
  const [activeTimer, setActiveTimer] = useState<{ section: "warmup" | "main"; scrollTo: () => void } | null>(null);

  const appShellStyle = useMemo(
    () =>
      ({
        "--sticky-footer-height": `${stickyFooterHeight}px`,
      }) as React.CSSProperties,
    [stickyFooterHeight]
  );

  const handleLoadTemplate = useCallback(async () => {
    const confirmed = await confirm({
      title: "Load session?",
      description: "This will overwrite the current workout list for the selected day.",
      confirmLabel: "Load",
      cancelLabel: "Keep Current",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    resetFromTemplate();
    showToast({ tone: "success", title: "Template loaded" });
  }, [confirm, resetFromTemplate, showToast]);

  const handleClearDay = useCallback(async () => {
    const confirmed = await confirm({
      title: "Clear all day data?",
      description: "This removes workout entries, notes, and checks for the selected day.",
      confirmLabel: "Clear Day",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    clearCurrentDay();
    showToast({ tone: "success", title: "Day cleared" });
  }, [clearCurrentDay, confirm, showToast]);

  const handleDuplicatePreviousDayNotesAndWeight = useCallback(() => {
    const duplicated = duplicatePreviousDayNotesAndWeight();
    if (!duplicated) {
      showToast({
        tone: "info",
        title: "Nothing to duplicate",
        description: "No previous day notes or weight were found.",
      });
      return;
    }
    showToast({ tone: "success", title: "Previous notes and weight duplicated" });
  }, [duplicatePreviousDayNotesAndWeight, showToast]);

  const handleDeleteItem = useCallback(
    async (section: "warmup" | "main", id: string) => {
      const confirmed = await confirm({
        title: "Remove exercise?",
        description: "This action removes the item from your current workout list.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!confirmed) {
        return false;
      }
      deleteItem(section, id);
      showToast({ tone: "info", title: "Exercise removed" });
      return true;
    },
    [confirm, deleteItem, showToast]
  );

  // Warn before unload if a debounced save is still in flight
  React.useEffect(() => {
    if (!isSaving) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSaving]);

  const handleDeleteSessionType = useCallback(
    async (sessionType: SessionType) => {
      const isInUse = usedSessionTypes.has(sessionType);
      const label = getSessionLabel(sessionType);
      const confirmed = await confirm({
        title: isInUse
          ? `"${label}" is used in your workout history`
          : `Delete "${label}"?`,
        description: isInUse
          ? "Those days will keep their data but their session label will show as unknown. Delete anyway?"
          : "This removes the session type and its template. Existing workout days are not affected.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!confirmed) {
        return { status: "error" as const, message: "Cancelled." };
      }
      return removeSessionType(sessionType);
    },
    [confirm, removeSessionType, usedSessionTypes]
  );

  useWorkoutKeyboardShortcuts({
    onJumpToday: jumpToToday,
    onLoadTemplate: () => void handleLoadTemplate(),
    onDuplicatePreviousDayNotesAndWeight: handleDuplicatePreviousDayNotesAndWeight,
  });

  if (!isLoaded || !areTemplatesLoaded) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-slate-200" style={appShellStyle}>
      <Header
        currentDate={currentDate}
        onDateChange={(event) => setCurrentDate(event.target.value)}
        sessionType={currentDay.sessionType}
        sessionOptions={sessionOptions}
        onSessionTypeChange={(event) => changeSessionType(event.target.value as SessionType)}
        onLoadTemplate={() => void handleLoadTemplate()}
        onJumpToday={jumpToToday}
        onNavigateSettings={() => setPage("settings")}
      />

      {page === "dashboard" ? (
        <DashboardContent
          fridayHint={fridayHint}
          currentDay={currentDay}
          onToggleItem={toggleItem}
          onDeleteItem={handleDeleteItem}
          onUpdateDay={updateDay}
          onUpdateDayDebounced={updateDayDebounced}
          onDuplicatePreviousDayNotesAndWeight={handleDuplicatePreviousDayNotesAndWeight}
          onActiveTimerChange={setActiveTimer}
        />
      ) : (
        <SettingsPage
          onBack={() => setPage("dashboard")}
          theme={theme}
          onThemeChange={setTheme}
          weightReminder={weightReminder}
          onUpdateWeightReminder={updateWeightReminder}
          templates={templates}
          sessionOptions={sessionOptions}
          templateSaveError={templateSaveError}
          lastSyncedAt={syncSettings.lastSyncedAt}
          lastSyncError={syncSettings.lastError}
          syncMessage={syncMessage}
          conflicts={conflicts}
          restorePoints={restorePoints}
          isSyncing={isSyncing}
          onSaveSectionTemplate={saveSectionTemplate}
          onUndoSectionTemplate={undoSectionTemplate}
          onResetSectionTemplate={resetSectionTemplate}
          onCreateSessionType={addSessionType}
          onDeleteSessionType={handleDeleteSessionType}
          onRenameSessionType={renameSessionType}
          onSyncNow={syncNow}
          onRollback={rollbackToRestorePoint}
          onPruneRestorePoints={pruneRestorePoints}
        />
      )}

      {page === "dashboard" && (
        <StickyFooter
          day={currentDay}
          isSaving={isSaving}
          onClear={() => void handleClearDay()}
          onHeightChange={setStickyFooterHeight}
          activeTimer={activeTimer}
        />
      )}

      {isQAMode && <QASmokePanel />}
    </div>
  );
}

export default App;