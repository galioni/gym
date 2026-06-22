import React, { useMemo } from "react";
import { Check, ChevronRight } from "lucide-react";
import { DayData, Plan, SessionOption } from "../../../../types";

interface WeekPlanBarProps {
  plan: Plan;
  allData: Record<string, DayData>;
  sessionOptions: SessionOption[];
  currentDate: string;
}

function getWeekDates(dateStr: string): string[] {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(d);
    date.setDate(d.getDate() + mondayOffset + i);
    return date.toISOString().slice(0, 10);
  });
}

function isDayDone(day: DayData): boolean {
  return [...day.warmup, ...day.main].some((item) => item.done);
}

export const WeekPlanBar: React.FC<WeekPlanBarProps> = ({
  plan,
  allData,
  sessionOptions,
  currentDate,
}) => {
  const slots = useMemo(() => {
    const weekDates = getWeekDates(currentDate);

    // Count done sessions per sessionType this week
    const doneCounts = new Map<string, number>();
    for (const date of weekDates) {
      const day = allData[date];
      if (day && isDayDone(day)) {
        doneCounts.set(day.sessionType, (doneCounts.get(day.sessionType) ?? 0) + 1);
      }
    }

    // Walk plan slots left-to-right, consuming done counts (handles duplicates)
    const consumed = new Map<string, number>();
    return plan.sessionIds.map((sessionType) => {
      const totalDone = doneCounts.get(sessionType) ?? 0;
      const consumedSoFar = consumed.get(sessionType) ?? 0;
      const done = consumedSoFar < totalDone;
      if (done) consumed.set(sessionType, consumedSoFar + 1);
      return { sessionType, done };
    });
  }, [plan, allData, currentDate]);

  const nextIndex = slots.findIndex((s) => !s.done);
  const allDone = nextIndex === -1 && slots.length > 0;

  const labelFor = (sessionType: string) =>
    sessionOptions.find((o) => o.value === sessionType)?.label ?? sessionType;

  if (slots.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
      <span className="text-[10px] font-semibold tracking-wider text-slate-600 uppercase shrink-0 mr-0.5">
        {plan.label}
      </span>

      {allDone ? (
        <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
          <Check size={11} />
          Week complete
        </span>
      ) : (
        slots.map((slot, i) => {
          const isNext = i === nextIndex;
          return (
            <span
              key={i}
              className={`inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap transition-colors ${
                slot.done
                  ? "bg-green-500/10 border-green-500/20 text-green-500/70"
                  : isNext
                  ? "bg-primary/15 border-primary/30 text-primary"
                  : "bg-white/[0.03] border-white/8 text-slate-600"
              }`}
            >
              {slot.done && <Check size={9} className="shrink-0" />}
              {isNext && <ChevronRight size={9} className="shrink-0" />}
              {labelFor(slot.sessionType)}
            </span>
          );
        })
      )}
    </div>
  );
};
