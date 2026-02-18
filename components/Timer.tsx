import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Button } from './ui/Button';
import { formatTimer } from '../utils';

interface TimerProps {
  initialMs: number;
  onSave: (ms: number) => void;
}

export const Timer: React.FC<TimerProps> = ({ initialMs, onSave }) => {
  const [ms, setMs] = useState(initialMs);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const msRef = useRef(initialMs);

  // Sync with prop changes (e.g., date change)
  useEffect(() => {
    setMs(initialMs);
    msRef.current = initialMs;
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [initialMs]);

  const tick = useCallback(() => {
    const now = Date.now();
    const delta = now - lastTimeRef.current;
    lastTimeRef.current = now;
    
    setMs((previous) => {
      const next = previous + delta;
      msRef.current = next;
      return next;
    });
  }, []);

  const toggle = () => {
    if (isRunning) {
      // Stop
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsRunning(false);
      onSave(msRef.current);
    } else {
      // Start
      lastTimeRef.current = Date.now();
      intervalRef.current = window.setInterval(tick, 100);
      setIsRunning(true);
    }
  };

  const reset = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setMs(0);
    msRef.current = 0;
    onSave(0);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Keep one autosave interval while running; msRef avoids effect churn on each tick.
  useEffect(() => {
    if (isRunning) {
      const saveInterval = setInterval(() => onSave(msRef.current), 5000);
      return () => clearInterval(saveInterval);
    }
  }, [isRunning, onSave]);

  return (
    <div className="flex items-center gap-2 bg-background/60 p-1.5 rounded-xl border border-white/10">
      <div className="text-lg font-bold w-[76px] text-center text-primary tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {formatTimer(ms)}
      </div>
      <Button 
        size="icon" 
        variant={isRunning ? "secondary" : "primary"} 
        onClick={toggle}
        className="h-8 w-8 rounded-lg"
        title={isRunning ? "Pause" : "Start"}
      >
        {isRunning ? <Pause size={14} /> : <Play size={14} />}
      </Button>
      <Button 
        size="icon" 
        variant="ghost" 
        onClick={reset}
        className="h-8 w-8 rounded-lg text-slate-400 hover:text-red-300"
        title="Reset"
      >
        <RotateCcw size={14} />
      </Button>
    </div>
  );
};
