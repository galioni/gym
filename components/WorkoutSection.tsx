import React, { useState, useRef, memo } from 'react';
import { Trash2, Check } from 'lucide-react';
import { WorkoutItem } from '../types';
import { Card } from './ui/Card';
import { Timer } from './Timer';
import { cn, vibrate } from '../utils';

interface WorkoutSectionProps {
  title: string;
  items: WorkoutItem[];
  timerMs: number;
  initialTimerRunning?: boolean;
  notes: string;
  onToggleItem: (id: string, isDone: boolean) => void;
  onDeleteItem: (id: string) => Promise<boolean>;
  onUpdateTimer: (ms: number) => void;
  onUpdateNotes: (text: string) => void;
  onTimerRunningChange?: (isRunning: boolean) => void;
  headerExtra?: React.ReactNode;
}

// Internal component for handling swipe logic - MEMOIZED for performance
const SwipeableWorkoutItem: React.FC<{ 
  item: WorkoutItem; 
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => Promise<boolean>;
}> = memo(({ item, onToggle, onDelete }) => {
  const [translateX, setTranslateX] = useState(0);
  const startX = useRef<number | null>(null);
  const isDragging = useRef(false);

  const DELETE_THRESHOLD = -60; 
  const MAX_SWIPE = -100;

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!startX.current) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX.current;

    if (diff < 0) {
      setTranslateX(Math.max(diff, MAX_SWIPE));
    } else if (diff > 0 && translateX < 0) {
       setTranslateX(Math.min(0, translateX + diff));
    }
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    startX.current = null;

    if (translateX < DELETE_THRESHOLD) {
      setTranslateX(MAX_SWIPE); 
    } else {
      setTranslateX(0); 
    }
  };

  const handleDeleteClick = async () => {
    vibrate(10);
    try {
      const wasDeleted = await onDelete(item.id);
      if (wasDeleted) {
        return;
      }
    } finally {
      setTranslateX(0);
    }
  };

  const handleToggle = (checked: boolean) => {
    vibrate(15);
    onToggle(item.id, checked);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl mb-3 group">
      <div className="absolute inset-0 bg-danger/10 flex items-center justify-end pr-5 rounded-2xl border border-danger/30">
        <button 
          onClick={handleDeleteClick}
          className="text-red-300 font-bold text-xs uppercase tracking-[0.15em] flex items-center gap-1 active:scale-95 transition-transform"
        >
          <Trash2 size={16} />
          Delete
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => void handleDeleteClick()}
          aria-label={`Delete ${item.text}`}
          className="absolute top-2 right-2 hidden md:group-hover:flex items-center justify-center h-7 w-7 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors z-20"
        >
          <Trash2 size={13} />
        </button>
      <label
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}
        className={cn(
          "relative flex items-start gap-4 p-4 pr-10 rounded-2xl border transition-all duration-300 cursor-pointer select-none z-10",
          item.done
            ? "bg-surface/35 border-transparent opacity-60 backdrop-blur-sm"
            : "bg-surfaceHighlight/45 border-white/10 hover:border-primary/40 hover:bg-surfaceHighlight/75 backdrop-blur-md shadow-md shadow-black/20"
        )}
      >
        <div className="pt-0.5 shrink-0 relative">
           <input 
            type="checkbox" 
            checked={item.done}
            onChange={(e) => handleToggle(e.target.checked)}
            className="peer sr-only"
          />
          <div className={cn(
            "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300",
            item.done 
              ? "bg-primary border-primary text-white scale-110" 
              : "border-slate-500 bg-transparent"
          )}>
            {item.done && <Check size={14} strokeWidth={3} />}
          </div>
        </div>
       
        <div className="flex-1 pointer-events-none"> 
          <div className={cn("text-base font-medium leading-snug transition-colors", item.done ? "line-through text-slate-500" : "text-slate-100")}>
            {item.text}
          </div>
          {item.target && (
            <div className="text-xs font-medium text-accent/80 mt-1.5 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-accent inline-block" />
              {item.target}
            </div>
          )}
        </div>
      </label>
      </div>
    </div>
  );
});

export const WorkoutSection: React.FC<WorkoutSectionProps> = ({
  title,
  items,
  timerMs,
  initialTimerRunning,
  notes,
  onToggleItem,
  onDeleteItem,
  onUpdateTimer,
  onUpdateNotes,
  onTimerRunningChange,
  headerExtra
}) => {
  return (
    <Card
      title={title}
      headerAction={
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:justify-end">
          {headerExtra}
          <Timer initialMs={timerMs} initialIsRunning={initialTimerRunning} onSave={onUpdateTimer} onRunningChange={onTimerRunningChange} />
        </div>
      }
      className="h-full flex flex-col motion-rise"
    >
      <div className="flex-1 mb-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 border-2 border-dashed border-white/10 rounded-2xl bg-background/35">
            <div className="text-sm font-medium">No exercises yet</div>
            <div className="text-xs opacity-60 mt-1.5 text-center px-4">Use <span className="font-semibold text-slate-400">Load</span> to apply a template, or go to <span className="font-semibold text-slate-400">Settings → Templates</span> to build one</div>
          </div>
        ) : (
          items.map((item) => (
            <SwipeableWorkoutItem 
              key={item.id} 
              item={item} 
              onToggle={onToggleItem} 
              onDelete={onDeleteItem}
            />
          ))
        )}
      </div>

      <div className="mt-auto">
        <label className="text-xs text-slate-400 font-bold mb-2 block uppercase tracking-[0.16em] pl-1">
          Session Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => onUpdateNotes(e.target.value)}
          placeholder="Log weights, feelings, or adjustments..."
          className="w-full bg-background/40 border border-white/10 rounded-2xl p-4 text-sm text-slate-200 placeholder:text-slate-600 focus:ring-2 focus:ring-primary/50 focus:border-transparent outline-none resize-none h-24 transition-all"
        />
      </div>
    </Card>
  );
};
