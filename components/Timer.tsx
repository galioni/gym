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

  // Sync with prop changes (e.g., date change)
  useEffect(() => {
    setMs(initialMs);
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
    
    setMs(prev => prev + delta);
  }, []);

  const toggle = () => {
    if (isRunning) {
      // Stop
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsRunning(false);
      onSave(ms);
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

  // Auto-save periodically if running to prevent massive data loss on crash
  useEffect(() => {
    if (isRunning) {
      const saveInterval = setInterval(() => onSave(ms), 5000);
      return () => clearInterval(saveInterval);
    }
  }, [isRunning, ms, onSave]);

  return (
    <div className="flex items-center gap-2 bg-surfaceHighlight/50 p-1.5 rounded-lg border border-border/50">
      <div className="font-mono text-lg font-bold w-[70px] text-center text-primary tabular-nums">
        {formatTimer(ms)}
      </div>
      <Button 
        size="icon" 
        variant={isRunning ? "secondary" : "primary"} 
        onClick={toggle}
        className="h-8 w-8 rounded-md"
        title={isRunning ? "Pause" : "Start"}
      >
        {isRunning ? <Pause size={14} /> : <Play size={14} />}
      </Button>
      <Button 
        size="icon" 
        variant="ghost" 
        onClick={reset}
        className="h-8 w-8 rounded-md text-slate-400 hover:text-red-400"
        title="Reset"
      >
        <RotateCcw size={14} />
      </Button>
    </div>
  );
};