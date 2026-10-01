import React, { useEffect, useRef, useState } from 'react';
import { Menu, X, Crosshair, Settings, History, LogOut, Zap } from 'lucide-react';
import { SessionOption, SessionType } from '../types';
import { Button } from './ui/Button';
import { cn, fromLocalDateKey } from '../utils';
import { SyncStatus } from '../application/sync/syncStatus';
import { SyncStatusIndicator } from '../features/sync/components/SyncStatusIndicator/SyncStatusIndicator';

interface HeaderProps {
  currentDate: string;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  sessionType: SessionType;
  sessionOptions: SessionOption[];
  onSessionTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onJumpToday: () => void;
  onNavigateSettings: () => void;
  onNavigateHistory?: () => void;
  userEmail?: string;
  onSignOut?: () => Promise<void>;
  isSigningOut?: boolean;
  onUpgrade?: () => void;
  /** Sync state shown next to the navigation; clicking it opens Settings. */
  syncStatus?: SyncStatus;
}

export const Header: React.FC<HeaderProps> = ({
  currentDate,
  onDateChange,
  sessionType,
  sessionOptions,
  onSessionTypeChange,
  onJumpToday,
  onNavigateSettings,
  onNavigateHistory,
  userEmail,
  onSignOut,
  isSigningOut,
  onUpgrade,
  syncStatus,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const todayKey = new Date().toLocaleDateString('en-CA');
  const isToday = currentDate === todayKey;

  const formattedDate = fromLocalDateKey(currentDate).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <header ref={menuRef} className="sticky top-0 z-40 border-b border-border bar-surface motion-sweep">
      <div className="max-w-5xl mx-auto px-4 py-3 md:py-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="display-title text-3xl md:text-4xl leading-none text-label">
              Daily Grind
            </h1>
            <p className="mt-1 text-labelSecondary text-xs font-medium tracking-[0.14em] uppercase">
              {formattedDate}
            </p>
            {userEmail && (
              <p className="hidden md:block text-[10px] text-labelTertiary tracking-[0.04em] truncate max-w-[160px]">{userEmail}</p>
            )}
          </div>

          {/* Mobile: sync state and hamburger */}
          <div className="md:hidden flex items-center gap-0.5">
            {syncStatus && <SyncStatusIndicator status={syncStatus} onClick={onNavigateSettings} />}
            <button
              ref={menuButtonRef}
              className="inline-flex items-center justify-center h-11 w-11 -mr-2 text-labelSecondary hover:text-label hover:bg-fill/10 rounded-full transition-colors focus:outline-none"
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Toggle menu"
              aria-expanded={isOpen}
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-end gap-3 bg-surface/60 border border-border rounded-2xl px-3 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-labelTertiary font-bold uppercase tracking-[0.14em] flex items-center gap-1.5">
                Date
                {isToday && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 px-1 py-0 rounded">Today</span>
                )}
              </label>
              <input
                type="date"
                value={currentDate}
                onChange={onDateChange}
                className={`bg-background/70 border rounded-lg px-2 py-1 text-xs text-label focus:ring-1 focus:ring-primary outline-none hover:border-primary/60 transition-colors ${isToday ? "border-primary/40" : "border-border"}`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-labelTertiary font-bold uppercase tracking-[0.14em]">Session</label>
              <select
                value={sessionType}
                onChange={onSessionTypeChange}
                className="bg-background/70 border border-border rounded-lg px-2 py-1 text-xs text-label focus:ring-1 focus:ring-primary outline-none w-40 hover:border-primary/60 transition-colors"
              >
                {(() => {
                  const userOpts = sessionOptions.filter((o) => o.source !== "ai");
                  const aiOpts = sessionOptions.filter((o) => o.source === "ai");
                  if (aiOpts.length === 0) {
                    return sessionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>);
                  }
                  return (
                    <>
                      {userOpts.length > 0 && (
                        <optgroup label="My Sessions">
                          {userOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                      )}
                      <optgroup label="AI Generated">
                        {aiOpts.map((o) => <option key={o.value} value={o.value}>{o.label} [AI]</option>)}
                      </optgroup>
                    </>
                  );
                })()}
              </select>
            </div>

            <Button onClick={onJumpToday} size="sm" variant="ghost" className="gap-2 min-h-11 px-3 text-xs">
              <Crosshair size={12} />
              Today
            </Button>

            {onUpgrade && (
              <button
                onClick={onUpgrade}
                className="flex items-center gap-1.5 px-3 h-11 rounded-xl text-xs font-semibold text-warningText border border-amber-400/30 hover:bg-amber-400/10 hover:text-warningText transition-colors"
              >
                <Zap size={12} />
                Upgrade
              </button>
            )}

            <div className="flex gap-1 ml-1 pl-3 border-l border-border">
              {syncStatus && <SyncStatusIndicator status={syncStatus} onClick={onNavigateSettings} showLabel />}
              {onNavigateHistory && (
                <Button onClick={onNavigateHistory} size="icon" variant="ghost" title="History" className="h-11 w-11">
                  <History size={14} />
                </Button>
              )}
              <Button onClick={onNavigateSettings} size="icon" variant="ghost" title="Settings" className="h-11 w-11">
                <Settings size={14} />
              </Button>
              {onSignOut && (
                <Button onClick={() => void onSignOut()} size="icon" variant="ghost" title="Sign out" disabled={isSigningOut} className="h-11 w-11">
                  <LogOut size={14} />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile menu — navigation only; session controls live inline on the home page */}
        <div className={cn(
          "md:hidden overflow-hidden transition-all duration-300 ease-in-out",
          isOpen ? "max-h-[320px] opacity-100 mt-4 border-t border-border pt-4" : "max-h-0 opacity-0"
        )}>
          <div className="space-y-3 pb-2 bg-surface/50 border border-border rounded-2xl p-3">
            {onNavigateHistory && (
              <Button onClick={() => { onNavigateHistory(); setIsOpen(false); }} variant="secondary" className="w-full min-h-11 gap-2 text-xs">
                <History size={14} />
                History
              </Button>
            )}
            {onUpgrade && (
              <button
                onClick={() => { onUpgrade(); setIsOpen(false); }}
                className="w-full flex items-center justify-center gap-2 min-h-11 rounded-xl text-sm font-semibold text-warningText border border-amber-400/30 hover:bg-amber-400/10 hover:text-warningText transition-colors"
              >
                <Zap size={14} />
                Upgrade to Pro
              </button>
            )}
            <Button onClick={() => { onNavigateSettings(); setIsOpen(false); }} variant="secondary" className="w-full min-h-11 gap-2 text-xs">
              <Settings size={14} />
              Settings
            </Button>
            {onSignOut && (
              <div className="pt-2 border-t border-border space-y-1">
                {userEmail && (
                  <p className="text-[10px] text-labelTertiary truncate px-1">{userEmail}</p>
                )}
                <Button
                  onClick={() => { void onSignOut(); setIsOpen(false); }}
                  variant="secondary"
                  className="w-full min-h-11 gap-2 text-xs"
                  disabled={isSigningOut}
                >
                  <LogOut size={14} />
                  Sign out
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
