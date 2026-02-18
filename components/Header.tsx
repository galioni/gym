import React, { useState } from 'react';
import { Menu, X, Calendar, Activity, RefreshCw, Download, Upload, Crosshair } from 'lucide-react';
import { SessionType } from '../types';
import { SESSION_OPTIONS } from '../constants';
import { Button } from './ui/Button';
import { cn, fromLocalDateKey } from '../utils';
import { useBackupIO } from '../features/session-controls/hooks/useBackupIO';
import { APP_THEME_OPTIONS, AppTheme } from '../features/theme/constants/themeOptions';

interface HeaderProps {
  currentDate: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionType: SessionType;
  onSessionTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onLoadTemplate: () => void;
  onJumpToday: () => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentDate,
  onDateChange,
  sessionType,
  onSessionTypeChange,
  onLoadTemplate,
  onJumpToday,
  theme,
  onThemeChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { fileInputRef, exportBackup, openImportPicker, handleImportFileChange } = useBackupIO();

  // Helper to format date for display
  const formattedDate = fromLocalDateKey(currentDate).toLocaleDateString('en-GB', {
    weekday: 'short', 
    day: 'numeric', 
    month: 'short' 
  });

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-background/80 backdrop-blur-xl motion-sweep">
      <div className="max-w-4xl mx-auto px-4 py-3 md:py-4">
        <div className="flex items-center justify-between">
            <div className="flex flex-col">
                 <h1 className="display-title text-3xl md:text-4xl leading-none text-white">
                  Daily Grind
                </h1>
                 <p className="text-slate-400 text-xs font-medium tracking-[0.2em] uppercase">
                  {formattedDate}
                </p>
            </div>

            <button 
                className="md:hidden p-2 -mr-2 text-slate-300 hover:text-white hover:bg-white/10 rounded-full transition-colors focus:outline-none"
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Toggle menu"
            >
                {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            <div className="hidden md:flex items-center gap-4 bg-surface/60 border border-white/10 rounded-2xl px-3 py-2">
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Date</label>
                    <input 
                        type="date" 
                        value={currentDate} 
                        onChange={onDateChange}
                        className="bg-background/70 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none hover:border-primary/60 transition-colors"
                    />
                 </div>
                 
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Session</label>
                    <select 
                        value={sessionType} 
                        onChange={onSessionTypeChange}
                        className="bg-background/70 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none w-40 hover:border-primary/60 transition-colors"
                    >
                        {SESSION_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label.split('(')[0].trim()}</option>
                        ))}
                    </select>
                 </div>

                 <div className="flex flex-col gap-1 justify-end">
                     <label className="text-[10px] opacity-0 select-none">Action</label>
                     <Button onClick={onLoadTemplate} size="sm" variant="secondary" className="gap-2 h-[30px] text-xs">
                       <RefreshCw size={12} />
                       Load Template
                     </Button>
                 </div>

                 <div className="flex flex-col gap-1 justify-end">
                     <label className="text-[10px] opacity-0 select-none">Today</label>
                     <Button onClick={onJumpToday} size="sm" variant="ghost" className="gap-2 h-[30px] text-xs">
                       <Crosshair size={12} />
                       Today
                     </Button>
                 </div>

                 <div className="flex gap-1 ml-1 pl-3 border-l border-white/10">
                    <Button onClick={exportBackup} size="icon" variant="ghost" title="Export Data" className="h-[30px] w-[30px]">
                        <Download size={14} />
                    </Button>
                    <Button onClick={openImportPicker} size="icon" variant="ghost" title="Import Data" className="h-[30px] w-[30px]">
                        <Upload size={14} />
                    </Button>
                 </div>

                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Theme</label>
                    <select
                      value={theme}
                      onChange={(event) => onThemeChange(event.target.value as AppTheme)}
                      className="bg-background/70 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none w-36 hover:border-primary/60 transition-colors"
                    >
                      {APP_THEME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                 </div>
            </div>
        </div>

        <div className={cn(
            "md:hidden overflow-hidden transition-all duration-300 ease-in-out",
            isOpen ? "max-h-[400px] opacity-100 mt-4 border-t border-white/10 pt-4" : "max-h-0 opacity-0"
        )}>
            <div className="space-y-4 pb-2 bg-surface/50 border border-white/10 rounded-2xl p-3">
                 <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.2em] flex items-center gap-2">
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
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.2em] flex items-center gap-2">
                        <Activity size={14} /> Session Type
                    </label>
                    <select 
                        value={sessionType} 
                        onChange={(e) => { onSessionTypeChange(e); setIsOpen(false); }}
                        className="w-full bg-background/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
                    >
                        {SESSION_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                 </div>

                 <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-[0.2em]">Theme</label>
                    <select
                      value={theme}
                      onChange={(event) => onThemeChange(event.target.value as AppTheme)}
                      className="w-full bg-background/80 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
                    >
                      {APP_THEME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                 </div>

                 <div className="grid grid-cols-2 gap-3 pt-2">
                    <Button onClick={() => { onLoadTemplate(); setIsOpen(false); }} variant="primary" className="gap-2 text-xs">
                       <RefreshCw size={14} />
                       Load Template
                    </Button>
                     <Button onClick={() => { onJumpToday(); setIsOpen(false); }} variant="ghost" className="gap-2 text-xs">
                       <Crosshair size={14} />
                       Today
                    </Button>
                </div>

                <div>
                     <Button onClick={() => { exportBackup(); setIsOpen(false); }} variant="secondary" className="w-full gap-2 text-xs">
                       <Download size={14} />
                       Backup Data
                    </Button>
                 </div>
                 
                 <Button onClick={() => { openImportPicker(); setIsOpen(false); }} variant="ghost" className="w-full gap-2 text-xs text-slate-400">
                    <Upload size={14} />
                    Restore from Backup
                 </Button>
            </div>
        </div>
      </div>
     
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImportFileChange} 
        accept=".json" 
        className="hidden" 
      />
    </header>
  );
};
