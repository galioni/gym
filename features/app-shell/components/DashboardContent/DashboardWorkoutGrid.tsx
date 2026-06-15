import React, { useRef, useCallback } from "react";
import { WorkoutSection } from "../../../../components/WorkoutSection";
import { DailyCheckCard } from "../../../workout/components/DailyCheckCard/DailyCheckCard";
import { DayData } from "../../../../types";

interface DashboardWorkoutGridProps {
  currentDay: DayData;
  timerRunning?: { warmup: boolean; main: boolean };
  onTimerRunningChange?: (section: "warmup" | "main", isRunning: boolean) => void;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => Promise<boolean>;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
  onActiveTimerChange?: (info: { section: "warmup" | "main"; scrollTo: () => void } | null) => void;
}

export const DashboardWorkoutGrid: React.FC<DashboardWorkoutGridProps> = ({
  currentDay,
  timerRunning,
  onTimerRunningChange,
  onToggleItem,
  onDeleteItem,
  onUpdateDay,
  onUpdateDayDebounced,
  onActiveTimerChange,
}) => {
  const warmupRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const scrollTo = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleWarmupRunningChange = useCallback((isRunning: boolean) => {
    onTimerRunningChange?.("warmup", isRunning);
    if (isRunning) {
      scrollTo(warmupRef);
      onActiveTimerChange?.({ section: "warmup", scrollTo: () => scrollTo(warmupRef) });
    } else {
      onActiveTimerChange?.(null);
    }
  }, [onActiveTimerChange, onTimerRunningChange, scrollTo]);

  const handleMainRunningChange = useCallback((isRunning: boolean) => {
    onTimerRunningChange?.("main", isRunning);
    if (isRunning) {
      scrollTo(mainRef);
      onActiveTimerChange?.({ section: "main", scrollTo: () => scrollTo(mainRef) });
    } else {
      onActiveTimerChange?.(null);
    }
  }, [onActiveTimerChange, onTimerRunningChange, scrollTo]);

  return (
    <div className="xl:flex xl:gap-6 xl:items-start pb-4">
      {/* Workout columns — 1-col on mobile, 2-col on md+ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 xl:flex-1 min-w-0">
        <div ref={warmupRef} className="motion-rise motion-delay-1">
          <WorkoutSection
            title="Warm-up"
            items={currentDay.warmup}
            timerMs={currentDay.warmupTimerMs}
            initialTimerRunning={timerRunning?.warmup}
            notes={currentDay.warmupNotes}
            onToggleItem={(id, done) => onToggleItem("warmup", id, done)}
            onDeleteItem={(id) => onDeleteItem("warmup", id)}
            onUpdateTimer={(ms) => onUpdateDay({ warmupTimerMs: ms })}
            onUpdateNotes={(txt) => onUpdateDayDebounced({ warmupNotes: txt })}
            onTimerRunningChange={handleWarmupRunningChange}
          />
        </div>

        <div ref={mainRef} className="motion-rise motion-delay-2">
          <WorkoutSection
            title="Main Session"
            items={currentDay.main}
            timerMs={currentDay.mainTimerMs}
            initialTimerRunning={timerRunning?.main}
            notes={currentDay.mainNotes}
            onToggleItem={(id, done) => onToggleItem("main", id, done)}
            onDeleteItem={(id) => onDeleteItem("main", id)}
            onUpdateTimer={(ms) => onUpdateDay({ mainTimerMs: ms })}
            onUpdateNotes={(txt) => onUpdateDayDebounced({ mainNotes: txt })}
            onTimerRunningChange={handleMainRunningChange}
          />
        </div>
      </div>

      {/* Daily check — full-width below workout on mobile/tablet, sticky sidebar on desktop */}
      <div className="mt-5 sm:mt-6 xl:mt-0 xl:w-72 xl:shrink-0 xl:sticky xl:top-20 motion-rise motion-delay-3">
        <DailyCheckCard
          day={currentDay}
          onUpdateField={(updates) => {
            const keys = Object.keys(updates);
            if (keys.length === 1 && ("checkNotes" in updates || "weight" in updates)) {
              onUpdateDayDebounced(updates);
              return;
            }
            onUpdateDay(updates);
          }}
        />
      </div>
    </div>
  );
};
