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
  onLoadTemplate: () => void;
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
  onLoadTemplate,
  onJumpToday,
}) => {
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
        onLoadTemplate={onLoadTemplate}
        onJumpToday={onJumpToday}
      />

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
