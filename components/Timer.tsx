import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Button } from './ui/Button';
import { formatTimer } from '../utils';

interface TimerProps {
  initialMs: number;
  initialIsRunning?: boolean;
  onSave: (ms: number) => void;
  onRunningChange?: (isRunning: boolean) => void;
}

export const Timer: React.FC<TimerProps> = ({ initialMs, initialIsRunning = false, onSave, onRunningChange }) => {
  const [ms, setMs] = useState(initialMs);
  const [isRunning, setIsRunning] = useState(initialIsRunning);
  const intervalRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const msRef = useRef(initialMs);
  // The last value this timer handed to onSave while running. The parent stores it and passes it back as initialMs, which
  // must not be mistaken for a change from outside (see the initialMs effect).
  const lastAutosavedRef = useRef<number | null>(null);
  const isRunningRef = useRef(initialIsRunning);
  const onSaveRef = useRef(onSave);
  const onRunningChangeRef = useRef(onRunningChange);

  // Keep callback refs current to avoid stale closures in cleanup
  useEffect(() => { onSaveRef.current = onSave; });
  useEffect(() => { onRunningChangeRef.current = onRunningChange; });

  // Keep isRunningRef in sync with state
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

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

  // Start running on mount if initialIsRunning; save on unmount if still running
  useEffect(() => {
    if (initialIsRunning) {
      lastTimeRef.current = Date.now();
      intervalRef.current = window.setInterval(tick, 100);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (isRunningRef.current) {
        onSaveRef.current(msRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount/unmount only

  // Sync with prop changes (e.g., date change resets timerMs to 0)
  useEffect(() => {
    // A running timer saves itself every 5 seconds and the saved value comes straight back in as this prop. That echo is
    // not a change from outside: resetting on it would stop the stopwatch at its first autosave.
    if (isRunningRef.current && initialMs === lastAutosavedRef.current) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setMs(initialMs);
    msRef.current = initialMs;
     
    setIsRunning(false);
    isRunningRef.current = false;
    onRunningChangeRef.current?.(false);
  }, [initialMs]);

  const toggle = () => {
    if (isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsRunning(false);
      onRunningChange?.(false);
      onSave(msRef.current);
    } else {
      lastAutosavedRef.current = null;
      lastTimeRef.current = Date.now();
      intervalRef.current = window.setInterval(tick, 100);
      setIsRunning(true);
      onRunningChange?.(true);
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

  // Autosave every 5 seconds while running
  useEffect(() => {
    if (isRunning) {
      const saveInterval = setInterval(() => {
        lastAutosavedRef.current = msRef.current;
        onSaveRef.current(msRef.current);
      }, 5000);
      return () => clearInterval(saveInterval);
    }
  }, [isRunning]);

  return (
    <div
      role="timer"
      aria-label={`Timer: ${isRunning ? "running" : "paused"}, ${formatTimer(ms)}`}
      className="flex w-full items-center justify-between gap-2 bg-background/60 p-1.5 rounded-xl border border-border sm:w-auto sm:justify-start"
    >
      <div aria-hidden="true" className="text-base sm:text-lg font-bold w-[68px] sm:w-[76px] text-center text-primary tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {formatTimer(ms)}
      </div>
      <Button
        size="icon"
        variant={isRunning ? "secondary" : "primary"}
        onClick={toggle}
        className="h-8 w-auto px-3 md:w-8 md:px-0 gap-1.5 rounded-lg text-xs"
        aria-label={isRunning ? "Pause timer" : "Start timer"}
        title={isRunning ? "Pause" : "Start"}
      >
        {isRunning ? <Pause size={14} /> : <Play size={14} />}
        <span className="md:hidden">{isRunning ? "Pause" : "Start"}</span>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={reset}
        className="h-8 w-8 rounded-lg text-labelSecondary hover:text-dangerText"
        aria-label="Reset timer"
        title="Reset"
      >
        <RotateCcw size={14} />
      </Button>
    </div>
  );
};
