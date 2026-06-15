import { useMemo } from "react";
import { DayData } from "../../../../types";
import { fromLocalDateKey } from "../../../../utils";

const PRIMARY = "rgb(255,122,26)";
const AREA_TOP = "rgba(255,122,26,0.18)";
const AREA_BOTTOM = "rgba(255,122,26,0.01)";

function parseWeight(raw: string): number | null {
  if (!raw.trim()) return null;
  const cleaned = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

interface WeightEntry {
  date: string;
  weight: number;
}

interface WeightChartProps {
  allData: Record<string, DayData>;
}

export function WeightChart({ allData }: WeightChartProps) {
  const entries = useMemo<WeightEntry[]>(() => {
    return Object.values(allData)
      .flatMap((day) => {
        const w = parseWeight(day.weight);
        return w !== null ? [{ date: day.date, weight: w }] : [];
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-90);
  }, [allData]);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-slate-600 text-center py-3">
        No weight logged yet — add your weight in the daily tracker.
      </p>
    );
  }

  const latest = entries[entries.length - 1];
  const first = entries[0];

  const formatDate = (d: string) =>
    fromLocalDateKey(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  if (entries.length === 1) {
    return (
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold text-white">{latest.weight} kg</span>
        <span className="text-xs text-slate-500">{formatDate(latest.date)}</span>
      </div>
    );
  }

  const delta = latest.weight - first.weight;
  const deltaLabel = delta === 0
    ? "no change"
    : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)} kg`;

  // SVG geometry
  const W = 500, H = 72;
  const PT = 6, PB = 6;
  const plotH = H - PT - PB;

  const weights = entries.map((e) => e.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;

  const toX = (i: number) => (i / (entries.length - 1)) * W;
  const toY = (w: number) => PT + plotH - ((w - minW) / range) * plotH;

  const linePts = entries.map((e, i) => `${toX(i)},${toY(e.weight)}`).join(" ");
  const areaPts = `0,${PT + plotH} ${linePts} ${W},${PT + plotH}`;

  // Show individual dots only when there are few enough entries to be legible
  const showAllDots = entries.length <= 20;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2.5">
          <span className="text-2xl font-bold text-white">{latest.weight} kg</span>
          <span className="text-xs text-slate-400">{deltaLabel}</span>
        </div>
        <span className="text-[11px] text-slate-600">
          {entries.length} entries
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="wgt-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AREA_TOP} />
            <stop offset="100%" stopColor={AREA_BOTTOM} />
          </linearGradient>
        </defs>
        <polygon points={areaPts} fill="url(#wgt-fill)" />
        <polyline
          points={linePts}
          fill="none"
          stroke={PRIMARY}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {showAllDots
          ? entries.map((e, i) => (
              <circle
                key={i}
                cx={toX(i)}
                cy={toY(e.weight)}
                r="3.5"
                fill={PRIMARY}
                vectorEffect="non-scaling-stroke"
              />
            ))
          : <>
              <circle cx={toX(0)} cy={toY(first.weight)} r="3.5" fill={PRIMARY} vectorEffect="non-scaling-stroke" />
              <circle cx={W} cy={toY(latest.weight)} r="3.5" fill={PRIMARY} vectorEffect="non-scaling-stroke" />
            </>
        }
      </svg>

      <div className="flex justify-between text-[10px] text-slate-600">
        <span>{formatDate(first.date)}</span>
        <span>{formatDate(latest.date)}</span>
      </div>
    </div>
  );
}
