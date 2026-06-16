import React, { useState } from "react";
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
  const [weightError, setWeightError] = useState<string | null>(null);

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      setWeightError(null);
      onUpdateField({ weight: "" });
      return;
    }
    const numeric = parseFloat(raw);
    if (isNaN(numeric) || numeric < 0) {
      setWeightError("Must be a positive number");
      return;
    }
    if (numeric > 500) {
      setWeightError("Value seems too high (max 500 kg)");
      return;
    }
    setWeightError(null);
    onUpdateField({ weight: raw });
  };

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
      <div className="flex flex-col md:flex-row gap-4">
        <div className="md:w-44 md:shrink-0">
          <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.18em] block mb-1.5">
            Weight (kg)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="500"
            placeholder="e.g. 79.5"
            value={day.weight}
            onChange={handleWeightChange}
            className={`w-full bg-background/50 border rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 outline-none transition-colors ${weightError ? "border-danger/50 focus:ring-danger/40" : "border-white/10 focus:ring-primary/50"}`}
          />
          {weightError && (
            <div className="mt-1 text-xs text-red-400">{weightError}</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
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
