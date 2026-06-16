import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkoutDataService } from "../../../application/workout/WorkoutDataService";
import { DayData, SessionType, Templates } from "../../../types";
import { createEmptyDay, fromLocalDateKey, toLocalDateKey } from "../../../utils";
import {
  applyDayUpdates,
  clearDayKeepingSession,
  deleteItemInSection,
  resetSectionsFromTemplate,
  toggleItemInSection,
} from "../../../application/workout/transitions/WorkoutStateTransitions";

export type WorkoutSectionKey = "warmup" | "main";

interface UseWorkoutTrackerResult {
  currentDate: string;
  isLoaded: boolean;
  isSaving: boolean;
  currentDay: DayData;
  allData: Record<string, DayData>;
  usedSessionTypes: Set<SessionType>;
  setCurrentDate: (date: string) => void;
  updateDay: (updates: Partial<DayData>) => void;
  updateDayDebounced: (updates: Partial<DayData>) => void;
  toggleItem: (section: WorkoutSectionKey, id: string, done: boolean) => void;
  deleteItem: (section: WorkoutSectionKey, id: string) => void;
  changeSessionType: (sessionType: SessionType) => void;
  resetFromTemplate: () => void;
  clearCurrentDay: () => void;
  jumpToToday: () => void;
  duplicatePreviousDayNotesAndWeight: () => boolean;
}

/**
 * UI-focused state coordinator for the daily tracker.
 * Persistence details are delegated to the application/infrastructure layers.
 */
export function useWorkoutTracker(service: WorkoutDataService, templates: Templates): UseWorkoutTrackerResult {
  const [currentDate, setCurrentDate] = useState<string>(() => {
    return toLocalDateKey(new Date());
  });
  const [allData, setAllData] = useState<Record<string, DayData>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const pendingPersistRef = useRef<Record<string, DayData> | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const savingIndicatorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        const loadedData = await service.loadAllData();
        if (!isCancelled) {
          setAllData(loadedData);
        }
      } catch (error) {
        console.error("Failed to load workout data", error);
      } finally {
        if (!isCancelled) {
          setIsLoaded(true);
        }
      }
    };

    void load();
    return () => {
      isCancelled = true;
    };
  }, [service]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
      if (savingIndicatorTimerRef.current) {
        clearTimeout(savingIndicatorTimerRef.current);
      }
    };
  }, []);

  const currentDay = useMemo(
    () => allData[currentDate] || createEmptyDay(currentDate, "tennis", templates),
    [allData, currentDate, templates]
  );

  const usedSessionTypes = useMemo(
    () => new Set(Object.values(allData).map((day) => day.sessionType)),
    [allData]
  );

  const flushPersist = useCallback(async () => {
    const dataToSave = pendingPersistRef.current;
    if (!dataToSave) {
      return;
    }

    pendingPersistRef.current = null;
    setIsSaving(true);
    try {
      await service.saveAllData(dataToSave);
      if (savingIndicatorTimerRef.current) {
        clearTimeout(savingIndicatorTimerRef.current);
      }
      savingIndicatorTimerRef.current = window.setTimeout(() => setIsSaving(false), 300);
    } catch (error) {
      console.error("Failed to save workout data", error);
      setIsSaving(false);
    }
  }, [service]);

  const schedulePersist = useCallback(
    (newData: Record<string, DayData>, debounceMs = 0) => {
      pendingPersistRef.current = newData;

      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      if (debounceMs > 0) {
        persistTimerRef.current = window.setTimeout(() => {
          void flushPersist();
        }, debounceMs);
      } else {
        void flushPersist();
      }
    },
    [flushPersist]
  );

  const updateDay = useCallback(
    (updates: Partial<DayData>, debounceMs = 0) => {
      setAllData((previousData) => {
        const existingDay = previousData[currentDate] || createEmptyDay(currentDate, "tennis", templates);
        const updatedDay = applyDayUpdates(existingDay, updates);
        const nextData = { ...previousData, [currentDate]: updatedDay };
        schedulePersist(nextData, debounceMs);
        return nextData;
      });
    },
    [currentDate, schedulePersist, templates]
  );

  const updateDayDebounced = useCallback(
    (updates: Partial<DayData>) => {
      updateDay(updates, 350);
    },
    [updateDay]
  );

  const toggleItem = useCallback(
    (section: WorkoutSectionKey, id: string, done: boolean) => {
      const nextDay = toggleItemInSection(currentDay, section, id, done);
      updateDay(nextDay, 0);
    },
    [currentDay, updateDay]
  );

  const deleteItem = useCallback(
    (section: WorkoutSectionKey, id: string) => {
      const nextDay = deleteItemInSection(currentDay, section, id);
      updateDay(nextDay, 0);
    },
    [currentDay, updateDay]
  );

  const changeSessionType = useCallback(
    (sessionType: SessionType) => {
      const nextDay = resetSectionsFromTemplate(currentDate, sessionType, currentDay, templates);
      updateDay(nextDay, 0);
    },
    [currentDate, currentDay, templates, updateDay]
  );

  const resetFromTemplate = useCallback(() => {
    const nextDay = resetSectionsFromTemplate(currentDate, currentDay.sessionType, currentDay, templates);
    updateDay(nextDay, 0);
  }, [currentDate, currentDay, updateDay, templates]);

  const clearCurrentDay = useCallback(() => {
    const freshDay = clearDayKeepingSession(currentDate, currentDay.sessionType, templates);
    updateDay({ ...freshDay, sessionType: currentDay.sessionType }, 0);
  }, [currentDate, currentDay.sessionType, updateDay, templates]);

  const handleSetCurrentDate = useCallback(
    (date: string) => {
      // Flush any pending debounced save before switching days to prevent data loss
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        void flushPersist();
      }
      setCurrentDate(date);
    },
    [flushPersist]
  );

  const jumpToToday = useCallback(() => {
    handleSetCurrentDate(toLocalDateKey(new Date()));
  }, [handleSetCurrentDate]);

  const duplicatePreviousDayNotesAndWeight = useCallback(() => {
    const current = fromLocalDateKey(currentDate);
    current.setDate(current.getDate() - 1);
    const previousDateKey = toLocalDateKey(current);
    const previousDay = allData[previousDateKey];
    if (!previousDay) {
      return false;
    }

    updateDay(
      {
        warmupNotes: previousDay.warmupNotes,
        mainNotes: previousDay.mainNotes,
        checkNotes: previousDay.checkNotes,
        weight: previousDay.weight,
      },
      0
    );
    return true;
  }, [allData, currentDate, updateDay]);

  return {
    currentDate,
    isLoaded,
    isSaving,
    currentDay,
    allData,
    usedSessionTypes,
    setCurrentDate: handleSetCurrentDate,
    updateDay,
    updateDayDebounced,
    toggleItem,
    deleteItem,
    changeSessionType,
    resetFromTemplate,
    clearCurrentDay,
    jumpToToday,
    duplicatePreviousDayNotesAndWeight,
  };
}
