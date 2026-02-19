import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { DayData } from '../types';
import { getProgress } from '../utils';
import { Button } from './ui/Button';
import { Save, Trash2 } from 'lucide-react';
import { cn } from '../utils';

interface StickyFooterProps {
  day: DayData;
  isSaving: boolean;
  onClear: () => void;
  onHeightChange?: (height: number) => void;
}

export const StickyFooter: React.FC<StickyFooterProps> = ({ day, isSaving, onClear, onHeightChange }) => {
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
      <div className="max-w-4xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex justify-between items-end px-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.16em]">Daily Progress</span>
            <span className={cn("text-xs font-bold", progress === 100 ? "text-accent" : "text-white")}>{progress}% Complete</span>
          </div>
          <div className="h-2.5 w-full bg-black/50 rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-700 ease-out shadow-[0_0_18px_rgba(255,122,26,0.6)]", progress === 100 ? "bg-accent" : "bg-primary")} 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end sm:pl-3 sm:border-l sm:border-white/10">
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
        </div>
      </div>
    </div>
  );
};
