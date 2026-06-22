import React, { useMemo } from "react";
import { Check, ChevronRight } from "lucide-react";
import { DayData, Plan, SessionOption } from "../../../../types";

const DAY_ABBR: Record<number, string> = {
  0: "Mo", 1: "Tu", 2: "We", 3: "Th", 4: "Fr", 5: "Sa", 6: "Su",
};

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

interface WeekPlanBarProps {
  plan: Plan;
  allData: Record<string, DayData>;
  sessionOptions: SessionOption[];
  currentDate: string;
  currentSessionType: string;
  onSelectSession?: (sessionType: string) => void;
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

function Pill({
  done,
  isCurrent,
  isNext,
  dayLabel,
  sessionLabel,
  onSelect,
}: {
  done: boolean;
  isCurrent: boolean;
  isNext: boolean;
  dayLabel?: string;
  sessionLabel: string;
  onSelect?: () => void;
}) {
  const className = [
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap transition-colors",
    done
      ? "bg-green-500/10 border-green-500/20 text-green-500/70"
      : isCurrent
      ? "bg-primary/25 border-primary/50 text-primary cursor-pointer hover:bg-primary/35"
      : isNext
      ? "bg-primary/15 border-primary/30 text-primary cursor-pointer hover:bg-primary/25"
      : onSelect
      ? "border-slate-700 text-slate-500 cursor-pointer hover:border-slate-500 hover:text-slate-400"
      : "border-slate-700 text-slate-500",
  ].join(" ");

  return (
    <span
      className={className}
      onClick={!done && onSelect ? () => onSelect() : undefined}
      role={!done && onSelect ? "button" : undefined}
      tabIndex={!done && onSelect ? 0 : undefined}
      onKeyDown={!done && onSelect ? (e) => e.key === "Enter" && onSelect() : undefined}
    >
      {done && <Check size={9} className="shrink-0" />}
      {!done && isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      {!done && !isCurrent && isNext && <ChevronRight size={9} className="shrink-0" />}
      {dayLabel && <span className="opacity-60 text-[10px] mr-0.5">{dayLabel}</span>}
      {sessionLabel}
    </span>
  );
}

export const WeekPlanBar: React.FC<WeekPlanBarProps> = ({
  plan,
  allData,
  sessionOptions,
  currentDate,
  currentSessionType,
  onSelectSession,
}) => {
  const labelFor = (sessionType: string) =>
    sessionOptions.find((o) => o.value === sessionType)?.label ?? sessionType;

  const hasSchedule = plan.schedule != null && Object.keys(plan.schedule).length > 0;

  // ── Schedule mode ─────────────────────────────────────────────────────────
  const scheduleSlots = useMemo(() => {
    if (!hasSchedule) return null;
    const weekDates = getWeekDates(currentDate);
    return WEEK_DAYS
      .filter((day) => plan.schedule![day] != null)
      .map((day) => {
        const sessionType = plan.schedule![day]!;
        const date = weekDates[day];
        const dayEntry = allData[date];
        const done =
          dayEntry != null &&
          isDayDone(dayEntry) &&
          dayEntry.sessionType === sessionType;
        return { day, sessionType, date, done };
      });
  }, [hasSchedule, plan.schedule, allData, currentDate]);

  const scheduleNextIndex = useMemo(() => {
    if (!scheduleSlots) return -1;
    const todayDow = new Date(currentDate + "T00:00:00").getDay();
    const todayMonIdx = todayDow === 0 ? 6 : todayDow - 1;
    const fromToday = scheduleSlots.findIndex((s) => !s.done && s.day >= todayMonIdx);
    if (fromToday !== -1) return fromToday;
    return scheduleSlots.findIndex((s) => !s.done);
  }, [scheduleSlots, currentDate]);

  // ── Ordered-pills mode (no schedule) ──────────────────────────────────────
  const orderedSlots = useMemo(() => {
    if (hasSchedule) return [];
    const weekDates = getWeekDates(currentDate);
    const doneCounts = new Map<string, number>();
    for (const date of weekDates) {
      const day = allData[date];
      if (day && isDayDone(day)) {
        doneCounts.set(day.sessionType, (doneCounts.get(day.sessionType) ?? 0) + 1);
      }
    }
    const consumed = new Map<string, number>();
    return plan.sessionIds.map((sessionType) => {
      const totalDone = doneCounts.get(sessionType) ?? 0;
      const consumedSoFar = consumed.get(sessionType) ?? 0;
      const done = consumedSoFar < totalDone;
      if (done) consumed.set(sessionType, consumedSoFar + 1);
      return { sessionType, done };
    });
  }, [hasSchedule, plan.sessionIds, allData, currentDate]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (hasSchedule && scheduleSlots) {
    const allDone = scheduleNextIndex === -1 && scheduleSlots.length > 0;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-slate-600 uppercase shrink-0 mr-0.5">
          {plan.label}
        </span>
        {allDone ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
            <Check size={11} />
            Week complete
          </span>
        ) : (
          scheduleSlots.map((slot, i) => (
            <Pill
              key={slot.day}
              done={slot.done}
              isCurrent={!slot.done && slot.sessionType === currentSessionType}
              isNext={i === scheduleNextIndex}
              dayLabel={DAY_ABBR[slot.day]}
              sessionLabel={labelFor(slot.sessionType)}
              onSelect={onSelectSession ? () => onSelectSession(slot.sessionType) : undefined}
            />
          ))
        )}
      </div>
    );
  }

  const nextIndex = orderedSlots.findIndex((s) => !s.done);
  const allDone = nextIndex === -1 && orderedSlots.length > 0;

  if (orderedSlots.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-wider text-slate-600 uppercase shrink-0 mr-0.5">
        {plan.label}
      </span>
      {allDone ? (
        <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
          <Check size={11} />
          Week complete
        </span>
      ) : (
        orderedSlots.map((slot, i) => (
          <Pill
            key={i}
            done={slot.done}
            isCurrent={!slot.done && slot.sessionType === currentSessionType}
            isNext={i === nextIndex}
            sessionLabel={labelFor(slot.sessionType)}
            onSelect={onSelectSession ? () => onSelectSession(slot.sessionType) : undefined}
          />
        ))
      )}
    </div>
  );
};
