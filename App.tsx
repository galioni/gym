import React, { useEffect, useMemo } from "react";
import { Header } from "./components/Header";
import { WorkoutSection } from "./components/WorkoutSection";
import { StickyFooter } from "./components/StickyFooter";
import { useWorkoutTracker } from "./features/workout/state/useWorkoutTracker";
import { getFridayHint } from "./utils";
import { InfoBanner } from "./features/app-shell/components/InfoBanner/InfoBanner";
import { RpeSelect } from "./features/workout/components/RpeSelect/RpeSelect";
import { DailyCheckCard } from "./features/workout/components/DailyCheckCard/DailyCheckCard";
import { QASmokePanel } from "./features/qa/components/QASmokePanel/QASmokePanel";
import { useTheme } from "./features/theme/hooks/useTheme";
import { useTemplates } from "./features/templates/state/useTemplates";
import { TemplateEditor } from "./features/templates/components/TemplateEditor/TemplateEditor";
import { Button } from "./components/ui/Button";
import { SessionType } from "./types";
import { createWorkoutServices } from "./infrastructure/workout/factory/createWorkoutServices";
import { useSyncSettings } from "./features/sync/state/useSyncSettings";
import { SyncSettingsPanel } from "./features/sync/components/SyncSettingsPanel/SyncSettingsPanel";

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

  useEffect(() => {
    const isTypingTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof HTMLElement)) {
        return false;
      }
      const tag = eventTarget.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        eventTarget.isContentEditable
      );
    };

    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        jumpToToday();
      } else if (key === "l") {
        event.preventDefault();
        if (confirm("This will overwrite the current list items. Continue?")) {
          resetFromTemplate();
        }
      } else if (key === "d") {
        event.preventDefault();
        const duplicated = duplicatePreviousDayNotesAndWeight();
        if (!duplicated) {
          alert("No previous day data found to duplicate.");
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [jumpToToday, resetFromTemplate, duplicatePreviousDayNotesAndWeight]);

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

      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        <InfoBanner content={fridayHint} />

        <div className="flex items-center justify-end gap-2 motion-rise">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const duplicated = duplicatePreviousDayNotesAndWeight();
              if (!duplicated) {
                alert("No previous day data found to duplicate.");
              }
            }}
          >
            Duplicate Prev Notes/Weight
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          <div className="motion-rise motion-delay-1">
            <WorkoutSection
              title="Warm-up"
              items={currentDay.warmup}
              timerMs={currentDay.warmupTimerMs}
              notes={currentDay.warmupNotes}
              onToggleItem={(id, done) => toggleItem("warmup", id, done)}
              onDeleteItem={(id) => deleteItem("warmup", id)}
              onUpdateTimer={(ms) => updateDay({ warmupTimerMs: ms })}
              onUpdateNotes={(txt) => updateDayDebounced({ warmupNotes: txt })}
            />
          </div>

          <div className="motion-rise motion-delay-2">
            <WorkoutSection
              title="Main Session"
              items={currentDay.main}
              timerMs={currentDay.mainTimerMs}
              notes={currentDay.mainNotes}
              onToggleItem={(id, done) => toggleItem("main", id, done)}
              onDeleteItem={(id) => deleteItem("main", id)}
              onUpdateTimer={(ms) => updateDay({ mainTimerMs: ms })}
              onUpdateNotes={(txt) => updateDayDebounced({ mainNotes: txt })}
              headerExtra={<RpeSelect value={currentDay.rpe} onChange={(value) => updateDay({ rpe: value })} />}
            />
          </div>

          <div className="md:hidden -mt-4 mb-2 flex justify-end">
            <RpeSelect mobile value={currentDay.rpe} onChange={(value) => updateDay({ rpe: value })} />
          </div>

          <div className="md:col-span-2 motion-rise motion-delay-3">
            <DailyCheckCard
              day={currentDay}
              onUpdateField={(updates) => {
                if ("checkNotes" in updates && Object.keys(updates).length === 1) {
                  updateDayDebounced(updates);
                  return;
                }
                updateDay(updates);
              }}
            />
          </div>

          <div className="md:col-span-2 motion-rise">
            <TemplateEditor
              templates={templates}
              onSaveSection={saveSectionTemplate}
              onUndoSection={undoSectionTemplate}
              onResetSection={resetSectionTemplate}
            />
          </div>

          <div className="md:col-span-2 motion-rise">
            <SyncSettingsPanel
              mode={syncSettings.mode}
              lastSyncedAt={syncSettings.lastSyncedAt}
              lastError={syncSettings.lastError}
              syncMessage={syncMessage}
              conflicts={conflicts}
              restorePoints={restorePoints}
              isSyncing={isSyncing}
              onModeChange={(mode) => void setSyncMode(mode)}
              onSyncNow={(resolution) => syncNow(resolution).then(() => undefined)}
              onRollback={(id) => rollbackToRestorePoint(id).then(() => undefined)}
            />
          </div>
        </div>
      </main>

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
