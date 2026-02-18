import React, { useMemo } from 'react';
import { DayData } from '../types';
import { getProgress } from '../utils';
import { Button } from './ui/Button';
import { Save, Trash2 } from 'lucide-react';
import { cn } from '../utils';

interface StickyFooterProps {
  day: DayData;
  isSaving: boolean;
  onClear: () => void;
}

export const StickyFooter: React.FC<StickyFooterProps> = ({ day, isSaving, onClear }) => {
  const progress = useMemo(() => getProgress(day), [day]);
  
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 glass-panel border-t border-white/15 p-3 md:p-4 pb-safe shadow-[0_-12px_50px_rgba(0,0,0,0.45)] motion-rise">
      <div className="max-w-4xl mx-auto flex items-center gap-5">
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex justify-between items-end px-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.24em]">Daily Progress</span>
            <span className={cn("text-xs font-bold", progress === 100 ? "text-accent" : "text-white")}>{progress}% Complete</span>
          </div>
          <div className="h-2.5 w-full bg-black/50 rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-700 ease-out shadow-[0_0_18px_rgba(255,122,26,0.6)]", progress === 100 ? "bg-accent" : "bg-primary")} 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pl-3 border-l border-white/10">
            <div className={cn("flex items-center gap-1.5 text-xs font-medium transition-all duration-300", isSaving ? "opacity-100 text-slate-300 translate-y-0" : "opacity-0 translate-y-2 absolute")}>
               <Save size={12} className="animate-pulse" />
               <span className="uppercase tracking-[0.18em]">Saving</span>
            </div>

            <Button 
                variant="danger" 
                size="icon" 
                onClick={onClear}
                className="shrink-0 w-10 h-10 rounded-2xl"
                title="Clear Day"
            >
                <Trash2 size={18} />
            </Button>
        </div>
      </div>
    </div>
  );
};
