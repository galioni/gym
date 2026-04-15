import React, { useEffect, useRef, useState } from 'react';
import { Menu, X, Calendar, Activity, RefreshCw, Crosshair, Settings } from 'lucide-react';
import { SessionOption, SessionType } from '../types';
import { Button } from './ui/Button';
import { cn, fromLocalDateKey } from '../utils';

interface HeaderProps {
  currentDate: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionType: SessionType;
  sessionOptions: SessionOption[];
  onSessionTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onLoadTemplate: () => void;
  onJumpToday: () => void;
  onNavigateSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentDate,
  onDateChange,
  sessionType,
  sessionOptions,
  onSessionTypeChange,
  onLoadTemplate,
  onJumpToday,
  onNavigateSettings,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const todayKey = new Date().toLocaleDateString('en-CA');
  const isToday = currentDate === todayKey;

  const formattedDate = fromLocalDateKey(currentDate).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <header ref={menuRef} className="sticky top-0 z-40 border-b border-white/10 bg-background/80 backdrop-blur-xl motion-sweep">
      <div className="max-w-4xl mx-auto px-4 py-3 md:py-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="display-title text-3xl md:text-4xl leading-none text-white">
              Daily Grind
            </h1>
            <p className="text-slate-400 text-xs font-medium tracking-[0.14em] uppercase">
              {formattedDate}
            </p>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden inline-flex items-center justify-center h-11 w-11 -mr-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-colors focus:outline-none"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* Desktop nav */}
          <div className="hidden md:flex items-end gap-3 bg-surface/60 border border-white/10 rounded-2xl px-3 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.14em] flex items-center gap-1.5">
                Date
                {isToday && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 px-1 py-0 rounded">Today</span>
                )}
              </label>
              <input
                type="date"
                value={currentDate}
                onChange={onDateChange}
                className={`bg-background/70 border rounded-lg px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none hover:border-primary/60 transition-colors ${isToday ? "border-primary/40" : "border-white/10"}`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.14em]">Session</label>
              <select
                value={sessionType}
                onChange={onSessionTypeChange}
                className="bg-background/70 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none w-40 hover:border-primary/60 transition-colors"
              >
                {sessionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <Button onClick={onLoadTemplate} size="sm" variant="secondary" className="gap-2 min-h-11 px-3 text-xs">
              <RefreshCw size={12} />
              Load
            </Button>

            <Button onClick={onJumpToday} size="sm" variant="ghost" className="gap-2 min-h-11 px-3 text-xs">
              <Crosshair size={12} />
              Today
            </Button>

            <div className="flex gap-1 ml-1 pl-3 border-l border-white/10">
              <Button onClick={onNavigateSettings} size="icon" variant="ghost" title="Settings" className="h-11 w-11">
                <Settings size={14} />
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        <div className={cn(
          "md:hidden overflow-hidden transition-all duration-300 ease-in-out",
          isOpen ? "max-h-[400px] opacity-100 mt-4 border-t border-white/10 pt-4" : "max-h-0 opacity-0"
        )}>
          <div className="space-y-4 pb-2 bg-surface/50 border border-white/10 rounded-2xl p-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.14em] flex items-center gap-2">
                <Calendar size={14} /> Date
              </label>
              <input
                type="date"
                value={currentDate}
                onChange={(e) => { onDateChange(e); setIsOpen(false); }}
                className="w-full bg-background/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.14em] flex items-center gap-2">
                <Activity size={14} /> Session Type
              </label>
              <select
                value={sessionType}
                onChange={(e) => { onSessionTypeChange(e); setIsOpen(false); }}
                className="w-full bg-background/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
              >
                {sessionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button onClick={() => { onLoadTemplate(); setIsOpen(false); }} variant="primary" className="gap-2 min-h-11 text-xs">
                <RefreshCw size={14} />
                Load
              </Button>
              <Button onClick={() => { onJumpToday(); setIsOpen(false); }} variant="ghost" className="gap-2 min-h-11 text-xs">
                <Crosshair size={14} />
                Today
              </Button>
            </div>

            <Button onClick={() => { onNavigateSettings(); setIsOpen(false); }} variant="secondary" className="w-full min-h-11 gap-2 text-xs">
              <Settings size={14} />
              Settings
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
