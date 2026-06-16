import React from 'react';
import { Calendar, Activity, RefreshCw, Crosshair } from 'lucide-react';
import { SessionOption, SessionType } from '../../../../types';
import { Button } from '../../../../components/ui/Button';

interface MobileSessionControlsProps {
  currentDate: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionType: SessionType;
  sessionOptions: SessionOption[];
  onSessionTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onLoadTemplate: () => void;
  onJumpToday: () => void;
}

export const MobileSessionControls: React.FC<MobileSessionControlsProps> = ({
  currentDate,
  onDateChange,
  sessionType,
  sessionOptions,
  onSessionTypeChange,
  onLoadTemplate,
  onJumpToday,
}) => {
  const todayKey = new Date().toLocaleDateString('en-CA');
  const isToday = currentDate === todayKey;

  return (
    <div className="md:hidden bg-surface/50 border border-white/10 rounded-2xl p-3 space-y-3 motion-rise">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.14em] flex items-center gap-1.5">
            <Calendar size={12} /> Date
            {isToday && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 px-1 py-0 rounded">
                Today
              </span>
            )}
          </label>
          <input
            type="date"
            value={currentDate}
            onChange={onDateChange}
            className={`bg-background/80 border rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none ${
              isToday ? 'border-primary/40' : 'border-white/10'
            }`}
          />
        </div>
        <div className="flex-1 space-y-1 min-w-0">
          <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.14em] flex items-center gap-1.5">
            <Activity size={12} /> Session
          </label>
          <select
            value={sessionType}
            onChange={onSessionTypeChange}
            className="w-full bg-background/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
          >
            {sessionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onLoadTemplate} variant="primary" className="gap-2 min-h-11 text-xs">
          <RefreshCw size={14} />
          Load
        </Button>
        <Button onClick={onJumpToday} variant="ghost" className="gap-2 min-h-11 text-xs">
          <Crosshair size={14} />
          Today
        </Button>
      </div>
    </div>
  );
};
