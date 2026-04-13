import React from "react";
import { WorkoutSection } from "../../../../components/WorkoutSection";
import { RpeSelect } from "../../../workout/components/RpeSelect/RpeSelect";
import { DailyCheckCard } from "../../../workout/components/DailyCheckCard/DailyCheckCard";
import { DayData } from "../../../../types";

interface DashboardWorkoutGridProps {
  currentDay: DayData;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => Promise<boolean>;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
}

export const DashboardWorkoutGrid: React.FC<DashboardWorkoutGridProps> = ({
  currentDay,
  onToggleItem,
  onDeleteItem,
  onUpdateDay,
  onUpdateDayDebounced,
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
