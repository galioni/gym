import React, { useState, useEffect, useCallback } from 'react';
import { Dumbbell, Scale } from 'lucide-react';
import { DayData, SessionType, WorkoutItem } from './types';
import { SESSION_OPTIONS, STORAGE_KEY } from './constants';
import { createEmptyDay, getFridayHint } from './utils';
import { Card } from './components/ui/Card';
import { Header } from './components/Header';
import { WorkoutSection } from './components/WorkoutSection';
import { StickyFooter } from './components/StickyFooter';

function App() {
  // --- State ---
  const [currentDate, setCurrentDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const [allData, setAllData] = useState<Record<string, DayData>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // --- Derived State ---
  const currentDay: DayData = allData[currentDate] || createEmptyDay(currentDate, 'tennis');

  // --- Effects ---
  
  // Load data on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setAllData(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load data", e);
    }
    setIsLoaded(true);
  }, []);

  // Save data on change
  const persistData = useCallback((newData: Record<string, DayData>) => {
    setIsSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      // Fake a small delay to show saving state visually
      setTimeout(() => setIsSaving(false), 600);
    } catch (e) {
      console.error("Failed to save data", e);
      setIsSaving(false);
    }
  }, []);

  const updateDay = useCallback((updates: Partial<DayData>) => {
    setAllData(prev => {
      const day = prev[currentDate] || createEmptyDay(currentDate, 'tennis');
      const updatedDay = { ...day, ...updates };
      const newData = { ...prev, [currentDate]: updatedDay };
      persistData(newData);
      return newData;
    });
  }, [currentDate, persistData]);

  // --- Handlers ---

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentDate(e.target.value);
  };

  const handleSessionTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as SessionType;
    updateDay({ sessionType: newType });
  };

  const handleLoadTemplate = () => {
    if (confirm("This will overwrite the current list items. Continue?")) {
      const fresh = createEmptyDay(currentDate, currentDay.sessionType);
      // Smart reset: Keep notes/weight, reset lists/timers.
      updateDay({
        warmup: fresh.warmup,
        main: fresh.main,
        warmupTimerMs: 0,
        mainTimerMs: 0
      });
    }
  };

  const handleClearDay = () => {
    if (confirm("Are you sure you want to clear all data for this day?")) {
      const fresh = createEmptyDay(currentDate, currentDay.sessionType);
      // Keep session type, wipe everything else
      updateDay({ ...fresh, sessionType: currentDay.sessionType });
    }
  };

  const handleToggleItem = (section: 'warmup' | 'main', id: string, done: boolean) => {
    const items = currentDay[section].map(item => 
      item.id === id ? { ...item, done } : item
    );
    updateDay({ [section]: items });
  };

  const handleDeleteItem = (section: 'warmup' | 'main', id: string) => {
    const items = currentDay[section].filter(item => item.id !== id);
    updateDay({ [section]: items });
  };

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-background text-slate-200">
      
      <Header 
        currentDate={currentDate}
        onDateChange={handleDateChange}
        sessionType={currentDay.sessionType}
        onSessionTypeChange={handleSessionTypeChange}
        onLoadTemplate={handleLoadTemplate}
      />

      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        
        {/* Info Banner */}
        <div className="bg-surfaceHighlight/30 border border-primary/20 rounded-lg p-3 flex items-center gap-3 text-sm text-indigo-200">
           <Scale size={16} className="text-primary shrink-0" />
           {getFridayHint(currentDate)}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          
          {/* Warm-up Section */}
          <WorkoutSection 
            title="Warm-up"
            items={currentDay.warmup}
            timerMs={currentDay.warmupTimerMs}
            notes={currentDay.warmupNotes}
            onToggleItem={(id, done) => handleToggleItem('warmup', id, done)}
            onDeleteItem={(id) => handleDeleteItem('warmup', id)}
            onUpdateTimer={(ms) => updateDay({ warmupTimerMs: ms })}
            onUpdateNotes={(txt) => updateDay({ warmupNotes: txt })}
          />

          {/* Main Workout Section */}
          <WorkoutSection 
            title="Main Session"
            items={currentDay.main}
            timerMs={currentDay.mainTimerMs}
            notes={currentDay.mainNotes}
            onToggleItem={(id, done) => handleToggleItem('main', id, done)}
            onDeleteItem={(id) => handleDeleteItem('main', id)}
            onUpdateTimer={(ms) => updateDay({ mainTimerMs: ms })}
            onUpdateNotes={(txt) => updateDay({ mainNotes: txt })}
            headerExtra={
              <div className="mr-4 hidden sm:block">
                 <select 
                   value={currentDay.rpe} 
                   onChange={(e) => updateDay({ rpe: e.target.value })}
                   className="bg-surface border border-border rounded px-2 py-1 text-xs text-slate-300 focus:ring-1 focus:ring-primary outline-none"
                   title="Rate of Perceived Exertion"
                 >
                   <option value="">RPE -</option>
                   {[4,5,6,7,8,9,10].map(v => <option key={v} value={v}>{v}</option>)}
                 </select>
              </div>
            }
          />
          
          {/* Mobile-only RPE (shows below Main Session on mobile) */}
          <div className="md:hidden -mt-4 mb-2 flex justify-end">
             <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2">
                <span className="text-xs text-slate-400 font-bold uppercase">RPE</span>
                <select 
                   value={currentDay.rpe} 
                   onChange={(e) => updateDay({ rpe: e.target.value })}
                   className="bg-transparent text-sm text-primary font-bold outline-none"
                 >
                   <option value="">--</option>
                   {[4,5,6,7,8,9,10].map(v => <option key={v} value={v}>{v}</option>)}
                 </select>
             </div>
          </div>

          {/* Daily Check Card */}
          <Card className="md:col-span-2" title={<div className="flex items-center gap-2"><Dumbbell size={18} /><span>Quick Check</span></div>}>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                   <label className="text-xs text-slate-500 font-medium uppercase tracking-wider block mb-1.5">
                     Weight (kg)
                   </label>
                   <input 
                     type="number" 
                     inputMode="decimal"
                     step="0.1"
                     min="0" 
                     placeholder="e.g. 79.5" 
                     value={currentDay.weight}
                     onChange={(e) => updateDay({ weight: e.target.value })}
                     className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
                   />
                </div>
                <div className="md:col-span-2">
                   <label className="text-xs text-slate-500 font-medium uppercase tracking-wider block mb-1.5">
                     Check-in Notes
                   </label>
                   <input 
                     type="text" 
                     placeholder="Sleep quality, stress levels, soreness..." 
                     value={currentDay.checkNotes}
                     onChange={(e) => updateDay({ checkNotes: e.target.value })}
                     className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
                   />
                </div>
             </div>
          </Card>
        </div>
      </main>
      
      {/* Sticky Progress Footer */}
      <StickyFooter day={currentDay} isSaving={isSaving} onClear={handleClearDay} />
    </div>
  );
}

export default App;