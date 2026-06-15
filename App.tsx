import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { StickyFooter } from "./components/StickyFooter";
import { useWorkoutTracker } from "./features/workout/state/useWorkoutTracker";
import { getFridayHint } from "./utils";
import { QASmokePanel } from "./features/qa/components/QASmokePanel/QASmokePanel";
import { useTheme } from "./features/theme/hooks/useTheme";
import { useTemplates } from "./features/templates/state/useTemplates";
import { PlanParams, SessionType } from "./types";
import { createWorkoutServices } from "./infrastructure/workout/factory/createWorkoutServices";
import { useSyncSettings } from "./features/sync/state/useSyncSettings";
import { useWorkoutKeyboardShortcuts } from "./features/app-shell/hooks/useWorkoutKeyboardShortcuts";
import { DashboardContent } from "./features/app-shell/components/DashboardContent/DashboardContent";
import { useFeedback } from "./features/feedback/hooks/useFeedback";
import { getSessionLabel, getSessionOptions } from "./application/workout/sessionTypes/sessionTypeRules";
import { usePlans } from "./features/plans/state/usePlans";
import { useWeightReminder } from "./features/weight-reminder/hooks/useWeightReminder";
import { ONBOARDING_STORAGE_KEY, PLAN_PARAMS_STORAGE_KEY } from "./constants";

const SettingsPage = React.lazy(() =>
  import("./features/settings/components/SettingsPage/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const OnboardingWizard = React.lazy(() =>
  import("./features/onboarding/components/OnboardingWizard/OnboardingWizard").then((m) => ({ default: m.OnboardingWizard }))
);

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
    replaceTemplates,
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
    isUpgradeRequired,
    conflicts,
    restorePoints,
    syncMessage,
    syncNow,
    rollbackToRestorePoint,
    pruneRestorePoints,
  } = useSyncSettings(services.syncService);

  const { plans, activePlanId, createPlan, updatePlan, deletePlan, setActivePlan } = usePlans(services.planService);

  const allSessionOptions = useMemo(() => getSessionOptions(templates), [templates]);
  const sessionOptions = useMemo(() => {
    const activePlan = plans.find((p) => p.id === activePlanId);
    if (!activePlan || activePlan.sessionIds.length === 0) return allSessionOptions;
    return allSessionOptions.filter((o) => activePlan.sessionIds.includes(o.value));
  }, [allSessionOptions, plans, activePlanId]);
  const { settings: weightReminder, updateSettings: updateWeightReminder } = useWeightReminder();
  const fridayHint = useMemo(
    () => getFridayHint(weightReminder.enabled, weightReminder.targetTime),
    [weightReminder.enabled, weightReminder.targetTime]
  );
  const [stickyFooterHeight, setStickyFooterHeight] = useState(124);
  const [page, setPage] = useState<"dashboard" | "settings">("dashboard");
  const [activeTimer, setActiveTimer] = useState<{ section: "warmup" | "main"; scrollTo: () => void } | null>(null);
  const [timerRunning, setTimerRunning] = useState({ warmup: false, main: false });
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Reset timer running state when the date changes (timers don't carry across days)
  const [prevDate, setPrevDate] = useState(currentDate);
  if (prevDate !== currentDate) {
    setPrevDate(currentDate);
    setTimerRunning({ warmup: false, main: false });
  }

  const handleTimerRunningChange = useCallback((section: "warmup" | "main", isRunning: boolean) => {
    setTimerRunning((prev) => ({ ...prev, [section]: isRunning }));
  }, []);
  const [hasOnboarded, setHasOnboarded] = useState(
    () => localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true"
  );
  const [savedPlanParams, setSavedPlanParams] = useState<PlanParams | null>(() => {
    try {
      const raw = localStorage.getItem(PLAN_PARAMS_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PlanParams) : null;
    } catch {
      return null;
    }
  });

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
    onShowShortcuts: () => setShowShortcutsModal(true),
  });

  if (!isLoaded || !areTemplatesLoaded) {
    return null;
  }

  if (!hasOnboarded) {
    return (
      <React.Suspense fallback={null}>
        <OnboardingWizard
          initialValues={savedPlanParams ?? undefined}
          onComplete={async (generatedTemplates, params) => {
            await replaceTemplates(generatedTemplates);
            localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
            localStorage.setItem(PLAN_PARAMS_STORAGE_KEY, JSON.stringify(params));
            setSavedPlanParams(params);
            setHasOnboarded(true);
          }}
          onSkip={() => {
            localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
            setHasOnboarded(true);
          }}
        />
      </React.Suspense>
    );
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
          timerRunning={timerRunning}
          onTimerRunningChange={handleTimerRunningChange}
          onToggleItem={toggleItem}
          onDeleteItem={handleDeleteItem}
          onUpdateDay={updateDay}
          onUpdateDayDebounced={updateDayDebounced}
          onDuplicatePreviousDayNotesAndWeight={handleDuplicatePreviousDayNotesAndWeight}
          onActiveTimerChange={setActiveTimer}
        />
      ) : (
        <React.Suspense fallback={null}>
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
            isUpgradeRequired={isUpgradeRequired}
            onSaveSectionTemplate={saveSectionTemplate}
            onUndoSectionTemplate={undoSectionTemplate}
            onResetSectionTemplate={resetSectionTemplate}
            onCreateSessionType={addSessionType}
            onDeleteSessionType={handleDeleteSessionType}
            onRenameSessionType={renameSessionType}
            onSyncNow={syncNow}
            onRollback={rollbackToRestorePoint}
            onPruneRestorePoints={pruneRestorePoints}
            plans={plans}
            activePlanId={activePlanId}
            onCreatePlan={createPlan}
            onUpdatePlan={updatePlan}
            onDeletePlan={deletePlan}
            onSetActivePlan={setActivePlan}
            planParams={savedPlanParams ?? undefined}
            onRegeneratePlan={() => {
              localStorage.removeItem(ONBOARDING_STORAGE_KEY);
              setHasOnboarded(false);
              setPage("dashboard");
            }}
          />
        </React.Suspense>
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

      {showShortcutsModal && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={() => setShowShortcutsModal(false)}
        >
          <div
            className="glass-panel rounded-2xl border border-white/15 p-6 w-full max-w-sm shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-white">Keyboard Shortcuts</h2>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="text-slate-400 hover:text-white transition-colors text-xs"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              {([
                ["T", "Jump to today"],
                ["L", "Load template for current session"],
                ["D", "Copy yesterday's notes & weight"],
                ["?", "Show this help"],
              ] as [string, string][]).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-300">{label}</span>
                  <kbd className="text-xs font-mono bg-white/10 border border-white/15 rounded px-2 py-0.5 text-slate-300 shrink-0">{key}</kbd>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-slate-500">Shortcuts are disabled when typing in a field.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;