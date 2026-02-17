import React, { useState, useRef } from 'react';
import { Menu, X, Calendar, Activity, RefreshCw, Download, Upload } from 'lucide-react';
import { SessionType } from '../types';
import { SESSION_OPTIONS, STORAGE_KEY } from '../constants';
import { Button } from './ui/Button';
import { cn } from '../utils';

interface HeaderProps {
  currentDate: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionType: SessionType;
  onSessionTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onLoadTemplate: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentDate,
  onDateChange,
  sessionType,
  onSessionTypeChange,
  onLoadTemplate
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to format date for display
  const formattedDate = new Date(currentDate).toLocaleDateString('en-GB', { 
    weekday: 'short', 
    day: 'numeric', 
    month: 'short' 
  });

  const handleExport = () => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) {
        alert("No data to export!");
        return;
      }
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workout-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("Failed to export data.");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        // Basic validation
        JSON.parse(json); 
        if (confirm("This will replace ALL your current data. Are you sure?")) {
            localStorage.setItem(STORAGE_KEY, json);
            window.location.reload();
        }
      } catch (err) {
        alert("Invalid backup file.");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  return (
    <header className="bg-surface/80 backdrop-blur-md border-b border-border sticky top-0 z-40 transition-all shadow-sm">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
            {/* Logo / Title Area */}
            <div className="flex flex-col">
                 <h1 className="text-lg md:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">
                  Daily Tracker
                </h1>
                 <p className="text-slate-400 text-xs font-medium">
                  {formattedDate}
                </p>
            </div>

            {/* Mobile Toggle */}
            <button 
                className="md:hidden p-2 -mr-2 text-slate-300 hover:text-white hover:bg-white/5 rounded-full transition-colors focus:outline-none"
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Toggle menu"
            >
                {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Desktop Controls */}
            <div className="hidden md:flex items-center gap-4">
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Date</label>
                    <input 
                        type="date" 
                        value={currentDate} 
                        onChange={onDateChange}
                        className="bg-background border border-border rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none hover:border-primary/50 transition-colors"
                    />
                 </div>
                 
                 <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Session</label>
                    <select 
                        value={sessionType} 
                        onChange={onSessionTypeChange}
                        className="bg-background border border-border rounded px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-primary outline-none w-40 hover:border-primary/50 transition-colors"
                    >
                        {SESSION_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label.split('(')[0].trim()}</option>
                        ))}
                    </select>
                 </div>

                 <div className="flex flex-col gap-1 justify-end">
                     <label className="text-[10px] opacity-0 select-none">Action</label>
                     <Button onClick={onLoadTemplate} size="sm" variant="secondary" className="gap-2 h-[26px] text-xs">
                       <RefreshCw size={12} />
                       Load Template
                     </Button>
                 </div>

                 {/* Desktop Data Controls */}
                 <div className="flex gap-1 ml-2 pl-2 border-l border-border/50">
                    <Button onClick={handleExport} size="icon" variant="ghost" title="Export Data" className="h-[26px] w-[26px]">
                        <Download size={14} />
                    </Button>
                    <Button onClick={handleImportClick} size="icon" variant="ghost" title="Import Data" className="h-[26px] w-[26px]">
                        <Upload size={14} />
                    </Button>
                 </div>
            </div>
        </div>

        {/* Mobile Menu (Collapsible) */}
        <div className={cn(
            "md:hidden overflow-hidden transition-all duration-300 ease-in-out",
            isOpen ? "max-h-[400px] opacity-100 mt-4 border-t border-border pt-4" : "max-h-0 opacity-0"
        )}>
            <div className="space-y-4 pb-2">
                 <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-wider flex items-center gap-2">
                        <Calendar size={14} /> Date
                    </label>
                    <input 
                        type="date" 
                        value={currentDate} 
                        onChange={(e) => { onDateChange(e); setIsOpen(false); }}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
                    />
                 </div>

                 <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium uppercase tracking-wider flex items-center gap-2">
                        <Activity size={14} /> Session Type
                    </label>
                    <select 
                        value={sessionType} 
                        onChange={(e) => { onSessionTypeChange(e); setIsOpen(false); }}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none appearance-none"
                    >
                        {SESSION_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                 </div>

                 <div className="grid grid-cols-2 gap-3 pt-2">
                    <Button onClick={() => { onLoadTemplate(); setIsOpen(false); }} variant="primary" className="gap-2 text-xs">
                       <RefreshCw size={14} />
                       Load Template
                    </Button>
                     <Button onClick={() => { handleExport(); setIsOpen(false); }} variant="secondary" className="gap-2 text-xs">
                       <Download size={14} />
                       Backup Data
                    </Button>
                 </div>
                 
                 <Button onClick={() => { handleImportClick(); setIsOpen(false); }} variant="ghost" className="w-full gap-2 text-xs text-slate-400">
                    <Upload size={14} />
                    Restore from Backup
                 </Button>
            </div>
        </div>
      </div>
      
      {/* Hidden File Input for Import */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept=".json" 
        className="hidden" 
      />
    </header>
  );
};