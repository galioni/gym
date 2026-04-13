import React from "react";
import { Button } from "../../../../components/ui/Button";
import { InfoBanner } from "../InfoBanner/InfoBanner";
import { DayData } from "../../../../types";
import { DashboardWorkoutGrid } from "./DashboardWorkoutGrid";

interface DashboardContentProps {
  fridayHint: string;
  currentDay: DayData;
  onToggleItem: (section: "warmup" | "main", id: string, done: boolean) => void;
  onDeleteItem: (section: "warmup" | "main", id: string) => Promise<boolean>;
  onUpdateDay: (updates: Partial<DayData>) => void;
  onUpdateDayDebounced: (updates: Partial<DayData>) => void;
  onDuplicatePreviousDayNotesAndWeight: () => void;
}

export const DashboardContent: React.FC<DashboardContentProps> = ({
  fridayHint,
  currentDay,
  onToggleItem,
  onDeleteItem,
  onUpdateDay,
  onUpdateDayDebounced,
  onDuplicatePreviousDayNotesAndWeight,
}) => {
  return (
    <main
      className="max-w-4xl mx-auto p-4 md:p-6 space-y-5 sm:space-y-6"
      style={{ paddingBottom: "calc(var(--sticky-footer-height, 0px) + 1rem)" }}
    >
      <InfoBanner content={fridayHint} />

      <div className="flex items-center justify-end gap-2 motion-rise">
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11"
          onClick={onDuplicatePreviousDayNotesAndWeight}
        >
          Duplicate Prev Notes/Weight
        </Button>
      </div>

      <DashboardWorkoutGrid
        currentDay={currentDay}
        onToggleItem={onToggleItem}
        onDeleteItem={onDeleteItem}
        onUpdateDay={onUpdateDay}
        onUpdateDayDebounced={onUpdateDayDebounced}
      />
    </main>
  );
};
