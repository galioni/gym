import React from "react";
import { DayData, SessionOption, SessionType } from "../../../../types";
import { DashboardWorkoutGrid } from "./DashboardWorkoutGrid";
import { MobileSessionControls } from "./MobileSessionControls";

interface DashboardContentProps {
  currentDay: DayData;
  timerRunning?: { warmup: boolean; main: boolean };
  onTimerRunningChange?: (section: "warmup" | "main", isRunning: boolean) => void;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => Promise<boolean>;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
  onActiveTimerChange?: (info: { section: "warmup" | "main"; scrollTo: () => void } | null) => void;
  // mobile session controls
  currentDate: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionOptions: SessionOption[];
  onSessionTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onJumpToday: () => void;
}

export const DashboardContent: React.FC<DashboardContentProps> = ({
  currentDay,
  timerRunning,
  onTimerRunningChange,
  onToggleItem,
  onDeleteItem,
  onUpdateDay,
  onUpdateDayDebounced,
  onActiveTimerChange,
  currentDate,
  onDateChange,
  sessionOptions,
  onSessionTypeChange,
  onJumpToday,
}) => {
  const activeOption = sessionOptions.find((o) => o.value === currentDay.sessionType);
  const sessionLabel = activeOption?.label ?? currentDay.sessionType;
  const sessionFocus = activeOption?.focus;
  const isAiSession = activeOption?.source === "ai";

  return (
    <main
      className="max-w-5xl mx-auto p-4 md:p-6 space-y-5 sm:space-y-6"
      style={{ paddingBottom: "calc(var(--sticky-footer-height, 0px) + 1rem)" }}
    >
      <MobileSessionControls
        currentDate={currentDate}
        onDateChange={onDateChange}
        sessionType={currentDay.sessionType}
        sessionOptions={sessionOptions}
        onSessionTypeChange={onSessionTypeChange}
        onJumpToday={onJumpToday}
      />

      <div>
        <div className="flex items-center gap-2">
          <h1 className="display-title text-2xl sm:text-3xl text-white leading-tight">
            {sessionLabel}
          </h1>
          {isAiSession && (
            <span className="text-[10px] font-semibold tracking-wider text-primary border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded self-center">
              AI
            </span>
          )}
        </div>
        {sessionFocus && (
          <p className="text-sm text-slate-400 mt-0.5">{sessionFocus}</p>
        )}
      </div>

      <DashboardWorkoutGrid
        currentDay={currentDay}
        timerRunning={timerRunning}
        onTimerRunningChange={onTimerRunningChange}
        onToggleItem={onToggleItem}
        onDeleteItem={onDeleteItem}
        onUpdateDay={onUpdateDay}
        onUpdateDayDebounced={onUpdateDayDebounced}
        onActiveTimerChange={onActiveTimerChange}
      />
    </main>
  );
};
