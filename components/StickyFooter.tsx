import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { DayData } from '../types';
import { getProgress } from '../utils';
import { Button } from './ui/Button';
import { Save, Trash2, Timer } from 'lucide-react';
import { cn } from '../utils';

interface StickyFooterProps {
  day: DayData;
  isSaving: boolean;
  onClear: () => void;
  onHeightChange?: (height: number) => void;
  activeTimer?: { section: "warmup" | "main"; scrollTo: () => void } | null;
}

export const StickyFooter: React.FC<StickyFooterProps> = ({ day, isSaving, onClear, onHeightChange, activeTimer }) => {
  const progress = useMemo(() => getProgress(day), [day]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!onHeightChange || !containerRef.current) {
      return;
    }

    const element = containerRef.current;
    const updateHeight = () => onHeightChange(Math.ceil(element.getBoundingClientRect().height));
    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);

    return () => observer.disconnect();
  }, [onHeightChange]);
  
  return (
    <div ref={containerRef} className="fixed bottom-0 left-0 right-0 z-50 glass-panel border-t border-white/15 p-3 md:p-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-[0_-8px_28px_rgba(0,0,0,0.32)] motion-rise">
      <div className="max-w-4xl mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex justify-between items-center px-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.16em]">Daily Progress</span>
            <div className="flex items-center gap-2">
              {activeTimer && (
                <button
                  type="button"
                  onClick={activeTimer.scrollTo}
                  className="flex items-center gap-1 text-xs font-bold text-primary uppercase tracking-[0.16em] animate-pulse hover:opacity-80 transition-opacity px-1"
                >
                  <Timer size={14} />
                  {activeTimer.section === "warmup" ? "Warm-up" : "Main"}
                </button>
              )}
              <span className={cn("text-xs font-bold", progress === 100 ? "text-accent" : "text-white")}>{progress}%</span>
              <Button
                variant="danger"
                size="icon"
                onClick={onClear}
                className="sm:hidden shrink-0 w-8 h-8 rounded-xl"
                title="Clear Day"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <div className="h-2.5 w-full bg-black/50 rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all duration-700 ease-out shadow-[0_0_18px_rgba(255,122,26,0.6)]", progress === 100 ? "bg-accent" : "bg-primary")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-white/10">
          <div
            aria-live="polite"
            className={cn(
              "min-w-[74px] flex items-center gap-1.5 text-xs font-medium transition-all duration-300",
              isSaving ? "opacity-100 text-slate-300 translate-y-0" : "opacity-0 translate-y-2"
            )}
          >
            <Save size={12} className="animate-pulse" />
            <span className="uppercase tracking-[0.18em]">Saving</span>
          </div>
          <Button
            variant="danger"
            size="icon"
            onClick={onClear}
            className="shrink-0 w-11 h-11 rounded-2xl"
            title="Clear Day"
          >
            <Trash2 size={18} />
          </Button>
          <span className="hidden md:inline-flex items-center text-[10px] text-slate-600 select-none" title="Press ? to see all keyboard shortcuts">
            <kbd className="font-mono bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-slate-500">?</kbd>
          </span>
        </div>
      </div>
    </div>
  );
};
