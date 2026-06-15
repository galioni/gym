import React from "react";
import { Button } from "../../../../components/ui/Button";
import { InfoBanner } from "../InfoBanner/InfoBanner";
import { DayData } from "../../../../types";
import { DashboardWorkoutGrid } from "./DashboardWorkoutGrid";

interface DashboardContentProps {
  fridayHint: string | null;
  currentDay: DayData;
  timerRunning?: { warmup: boolean; main: boolean };
  onTimerRunningChange?: (section: "warmup" | "main", isRunning: boolean) => void;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => Promise<boolean>;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
  onDuplicatePreviousDayNotesAndWeight: () => void;
  onActiveTimerChange?: (info: { section: "warmup" | "main"; scrollTo: () => void } | null) => void;
}

export const DashboardContent: React.FC<DashboardContentProps> = ({
  fridayHint,
  currentDay,
  timerRunning,
  onTimerRunningChange,
  onToggleItem,
  onDeleteItem,
  onUpdateDay,
  onUpdateDayDebounced,
  onDuplicatePreviousDayNotesAndWeight,
  onActiveTimerChange,
}) => {
  return (
    <main
      className="max-w-5xl mx-auto p-4 md:p-6 space-y-5 sm:space-y-6"
      style={{ paddingBottom: "calc(var(--sticky-footer-height, 0px) + 1rem)" }}
    >
      <InfoBanner content={fridayHint} />

      <div className="flex items-center justify-end gap-2 motion-rise">
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 gap-2"
          onClick={onDuplicatePreviousDayNotesAndWeight}
          title="Copy check-in weight and session notes from the previous day"
        >
          Copy Yesterday's Notes
          <kbd className="hidden md:inline-flex items-center font-mono text-[10px] bg-white/10 border border-white/15 rounded px-1.5 py-0.5 text-slate-400">D</kbd>
        </Button>
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
