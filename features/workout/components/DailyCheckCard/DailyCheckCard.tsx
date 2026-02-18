import React from "react";
import { Dumbbell } from "lucide-react";
import { DayData } from "../../../../types";
import { Card } from "../../../../components/ui/Card";

interface DailyCheckCardProps {
  day: DayData;
  onUpdateField: (updates: Partial<DayData>) => void;
}

/**
 * Captures lightweight daily readiness fields separated from workout list details.
 */
export const DailyCheckCard: React.FC<DailyCheckCardProps> = ({ day, onUpdateField }) => {
  return (
    <Card
      className="motion-rise"
      title={
        <div className="flex items-center gap-2">
          <Dumbbell size={18} />
          <span>Quick Check</span>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.18em] block mb-1.5">
            Weight (kg)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder="e.g. 79.5"
            value={day.weight}
            onChange={(event) => onUpdateField({ weight: event.target.value })}
            className="w-full bg-background/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.18em] block mb-1.5">
            Check-in Notes
          </label>
          <input
            type="text"
            placeholder="Sleep quality, stress levels, soreness..."
            value={day.checkNotes}
            onChange={(event) => onUpdateField({ checkNotes: event.target.value })}
            className="w-full bg-background/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
          />
        </div>
      </div>
    </Card>
  );
};
