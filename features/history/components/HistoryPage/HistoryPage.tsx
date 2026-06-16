import React, { useMemo } from "react";
import { ArrowLeft, Flame, Dumbbell, CalendarCheck, Trash2 } from "lucide-react";
import { DayData } from "../../../../types";
import { getProgress, fromLocalDateKey, toLocalDateKey, cn } from "../../../../utils";
import { getSessionLabel } from "../../../../application/workout/sessionTypes/sessionTypeRules";
import { WeightChart } from "../WeightChart/WeightChart";
import { SwipeToDeleteRow } from "./SwipeToDeleteRow";

interface HistoryPageProps {
  allData: Record<string, DayData>;
  onSelectDay: (dateKey: string) => void;
  onDeleteDay: (dateKey: string) => void;
  onBack: () => void;
}

function hasCompletedItems(day: DayData): boolean {
  return [...day.warmup, ...day.main].some((item) => item.done);
}

function isWorthyDay(day: DayData): boolean {
  return (
    hasCompletedItems(day) ||
    day.warmupNotes.trim().length > 0 ||
    day.mainNotes.trim().length > 0 ||
    day.weight.trim().length > 0
  );
}

function getWeekStart(dateKey: string): string {
  const date = fromLocalDateKey(dateKey);
  const dow = date.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setDate(date.getDate() + diff);
  return toLocalDateKey(date);
}

function weekLabel(weekStart: string): string {
  const today = new Date();
  const thisWeekStart = getWeekStart(toLocalDateKey(today));
  const lastWeekDate = fromLocalDateKey(thisWeekStart);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeekStart = toLocalDateKey(lastWeekDate);

  if (weekStart === thisWeekStart) return "This week";
  if (weekStart === lastWeekStart) return "Last week";

  return fromLocalDateKey(weekStart).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function calcStreak(allData: Record<string, DayData>): number {
  const today = new Date();
  const checkDate = new Date(today);

  const todayKey = toLocalDateKey(today);
  if (!allData[todayKey] || !hasCompletedItems(allData[todayKey])) {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  let streak = 0;
  while (true) {
    const key = toLocalDateKey(checkDate);
    const day = allData[key];
    if (!day || !hasCompletedItems(day)) break;
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }
  return streak;
}

function getThisWeekCount(allData: Record<string, DayData>): number {
  const today = new Date();
  const weekStart = fromLocalDateKey(getWeekStart(toLocalDateKey(today)));
  return Object.values(allData).filter((day) => {
    if (!hasCompletedItems(day)) return false;
    const date = fromLocalDateKey(day.date);
    return date >= weekStart && date <= today;
  }).length;
}

function parseSetCount(target: string | undefined): number {
  if (!target) return 0;
  const m = target.match(/(\d+)\s*[x×]\s*\d+/i) ?? target.match(/(\d+)\s*sets?\s+of\s+\d+/i);
  return m ? parseInt(m[1], 10) : 0;
}

function calcWeeklyVolume(days: DayData[]): number {
  return days.reduce(
    (total, day) =>
      total + day.main.filter((item) => item.done).reduce((s, item) => s + parseSetCount(item.target), 0),
    0
  );
}

function progressBarColor(pct: number): string {
  if (pct === 100) return "bg-emerald-500";
  if (pct >= 50) return "bg-primary";
  return "bg-amber-500";
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="flex-1 min-w-0 bg-surface/60 border border-white/10 rounded-2xl px-4 py-3 flex flex-col items-center gap-1">
      <div className="text-primary">{icon}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-[11px] text-slate-500 font-medium uppercase tracking-wider text-center leading-tight">
        {label}
      </div>
    </div>
  );
}

export function HistoryPage({ allData, onSelectDay, onDeleteDay, onBack }: HistoryPageProps) {
  const worthyDays = useMemo(
    () => Object.values(allData).filter(isWorthyDay).sort((a, b) => b.date.localeCompare(a.date)),
    [allData]
  );

  const streak = useMemo(() => calcStreak(allData), [allData]);
  const totalWorkouts = useMemo(
    () => Object.values(allData).filter(hasCompletedItems).length,
    [allData]
  );
  const thisWeek = useMemo(() => getThisWeekCount(allData), [allData]);

  const hasWeightData = useMemo(
    () => Object.values(allData).some((day) => day.weight.trim().length > 0),
    [allData]
  );

  const weekGroups = useMemo(() => {
    const groups: { weekStart: string; days: DayData[] }[] = [];
    const seen = new Map<string, DayData[]>();
    for (const day of worthyDays) {
      const ws = getWeekStart(day.date);
      if (!seen.has(ws)) {
        const arr: DayData[] = [];
        seen.set(ws, arr);
        groups.push({ weekStart: ws, days: arr });
      }
      seen.get(ws)!.push(day);
    }
    return groups;
  }, [worthyDays]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center justify-center h-9 w-9 text-slate-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-xl font-bold text-white">Workout History</h2>
      </div>

      <div className="flex gap-3">
        <StatCard icon={<Flame size={18} />} value={streak} label="Day streak" />
        <StatCard icon={<Dumbbell size={18} />} value={totalWorkouts} label="Total workouts" />
        <StatCard icon={<CalendarCheck size={18} />} value={thisWeek} label="This week" />
      </div>

      {hasWeightData && (
        <div className="bg-surface/60 border border-white/10 rounded-2xl px-4 py-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-3">Body weight</p>
          <WeightChart allData={allData} />
        </div>
      )}

      {weekGroups.length === 0 ? (
        <div className="text-center text-slate-500 py-16">
          <Dumbbell size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No workout history yet. Start tracking!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {weekGroups.map(({ weekStart, days }) => {
            const weeklyVolume = calcWeeklyVolume(days);
            return (
            <div key={weekStart}>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">
                {weekLabel(weekStart)}
                {weeklyVolume > 0 && (
                  <span className="font-normal normal-case tracking-normal"> · {weeklyVolume} sets</span>
                )}
              </p>
              <div className="space-y-1">
                {days.map((day) => {
                  const pct = getProgress(day);
                  const sessionLabel = getSessionLabel(day.sessionType);
                  const dateStr = fromLocalDateKey(day.date).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  });
                  return (
                    <div key={day.date} className="relative group">
                      <SwipeToDeleteRow onDelete={() => onDeleteDay(day.date)}>
                        <button
                          onClick={() => onSelectDay(day.date)}
                          className="w-full flex items-center gap-3 px-4 py-3 md:pr-10 bg-surface/40 hover:bg-surface/70 border border-white/[0.08] hover:border-white/15 rounded-xl transition-colors text-left"
                        >
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-white">{dateStr}</span>
                              <span className="text-xs text-slate-400 shrink-0">{sessionLabel}</span>
                            </div>
                            {pct > 0 && (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full", progressBarColor(pct))}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-slate-500 shrink-0 w-7 text-right">{pct}%</span>
                              </div>
                            )}
                          </div>
                          {day.weight.trim().length > 0 && (
                            <span className="text-xs text-slate-500 shrink-0">{day.weight} kg</span>
                          )}
                        </button>
                      </SwipeToDeleteRow>
                      {/* Desktop delete — outside SwipeToDeleteRow so it never competes with row content */}
                      <button
                        type="button"
                        onClick={() => onDeleteDay(day.date)}
                        className="hidden md:group-hover:flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center h-7 w-7 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                        aria-label="Delete day"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
