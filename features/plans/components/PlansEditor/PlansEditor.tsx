import React, { useState } from "react";
import { Plus, Pencil, Trash2, Check, X, CalendarDays } from "lucide-react";
import { Plan, SessionOption } from "../../../../types";
import { Button } from "../../../../components/ui/Button";
import { cn } from "../../../../utils";

interface PlansEditorProps {
  plans: Plan[];
  activePlanId: string | null;
  sessionOptions: SessionOption[];
  onCreatePlan: (label: string, sessionIds: string[], schedule?: Plan["schedule"]) => Promise<Plan>;
  onUpdatePlan: (id: string, updates: Partial<Pick<Plan, "label" | "sessionIds" | "schedule">>) => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
  onSetActivePlan: (id: string | null) => Promise<void>;
}

const DAY_LABELS: Record<number, string> = {
  0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday",
  4: "Friday", 5: "Saturday", 6: "Sunday",
};

const DAY_ABBR: Record<number, string> = {
  0: "Mo", 1: "Tu", 2: "We", 3: "Th", 4: "Fr", 5: "Sa", 6: "Su",
};

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function SessionToggle({
  option,
  selected,
  onToggle,
}: {
  option: SessionOption;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
        selected
          ? "border-primary bg-primary/20 text-primary"
          : "border-white/10 bg-white/5 text-slate-400 hover:border-white/25"
      )}
    >
      {option.label}
    </button>
  );
}

function DayScheduleGrid({
  selectedSessions,
  sessionOptions,
  schedule,
  onChange,
}: {
  selectedSessions: string[];
  sessionOptions: SessionOption[];
  schedule: Partial<Record<number, string>>;
  onChange: (schedule: Partial<Record<number, string>>) => void;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Day schedule</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center max-w-xs">
        {WEEK_DAYS.map((day) => (
          <React.Fragment key={day}>
            <span className="text-xs text-slate-400 w-20">{DAY_LABELS[day]}</span>
            <select
              value={schedule[day] ?? ""}
              onChange={(e) => {
                const next = { ...schedule };
                if (e.target.value) {
                  next[day] = e.target.value;
                } else {
                  delete next[day];
                }
                onChange(next);
              }}
              className="bg-background/70 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">—</option>
              {selectedSessions.map((id) => {
                const opt = sessionOptions.find((o) => o.value === id);
                return (
                  <option key={id} value={id}>
                    {opt?.label ?? id}
                  </option>
                );
              })}
            </select>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function PlanRow({
  plan,
  isActive,
  sessionOptions,
  onSetActive,
  onUpdate,
  onDelete,
}: {
  plan: Plan;
  isActive: boolean;
  sessionOptions: SessionOption[];
  onSetActive: () => Promise<void>;
  onUpdate: (updates: Partial<Pick<Plan, "label" | "sessionIds" | "schedule">>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(plan.label);
  const [selectedSessions, setSelectedSessions] = useState<string[]>(plan.sessionIds);
  const [isScheduleEnabled, setIsScheduleEnabled] = useState(
    () => plan.schedule != null && Object.keys(plan.schedule).length > 0
  );
  const [schedule, setSchedule] = useState<Partial<Record<number, string>>>(plan.schedule ?? {});

  const labelFor = (id: string) => sessionOptions.find((o) => o.value === id)?.label ?? id;

  const toggleSession = (id: string) => {
    setSelectedSessions((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      // Remove schedule entries for sessions no longer selected
      setSchedule((prevSchedule) => {
        const cleaned = { ...prevSchedule };
        for (const [day, session] of Object.entries(cleaned)) {
          if (session && !next.includes(session)) delete cleaned[Number(day)];
        }
        return cleaned;
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (!label.trim()) return;
    const finalSchedule =
      isScheduleEnabled && Object.keys(schedule).length > 0
        ? (schedule as Plan["schedule"])
        : undefined;
    await onUpdate({ label: label.trim(), sessionIds: selectedSessions, schedule: finalSchedule });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLabel(plan.label);
    setSelectedSessions(plan.sessionIds);
    setSchedule(plan.schedule ?? {});
    setIsScheduleEnabled(plan.schedule != null && Object.keys(plan.schedule).length > 0);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full bg-background/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-primary/50 outline-none"
          autoFocus
          maxLength={40}
        />
        <div>
          <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Sessions</p>
          <div className="flex flex-wrap gap-2">
            {sessionOptions.map((opt) => (
              <SessionToggle
                key={opt.value}
                option={opt}
                selected={selectedSessions.includes(opt.value)}
                onToggle={() => toggleSession(opt.value)}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsScheduleEnabled((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all",
            isScheduleEnabled
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300 hover:border-white/20"
          )}
        >
          <CalendarDays size={11} />
          Assign sessions to days
        </button>
        {isScheduleEnabled && (
          <DayScheduleGrid
            selectedSessions={selectedSessions}
            sessionOptions={sessionOptions}
            schedule={schedule}
            onChange={setSchedule}
          />
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="primary" className="gap-1" onClick={() => void handleSave()} disabled={!label.trim()}>
            <Check size={13} />
            Save
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={handleCancel}>
            <X size={13} />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Read view
  const hasSchedule = plan.schedule != null && Object.keys(plan.schedule).length > 0;
  const sessionSummary = hasSchedule
    ? (Object.entries(plan.schedule!) as [string, string][])
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([day, session]) => `${DAY_ABBR[Number(day)]}: ${labelFor(session)}`)
        .join(" · ")
    : plan.sessionIds.length === 0
    ? "No sessions"
    : plan.sessionIds.map(labelFor).join(", ");

  return (
    <div className={cn(
      "rounded-xl border p-3 flex items-start justify-between gap-3",
      isActive ? "border-primary/30 bg-primary/5" : "border-white/10 bg-white/3"
    )}>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{plan.label}</span>
          {isActive && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider text-primary border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded-md"
              title="This plan is active — the session dropdown in the header only shows its sessions"
            >
              Active
            </span>
          )}
          {hasSchedule && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
              <CalendarDays size={9} />
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 truncate">{sessionSummary}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant={isActive ? "ghost" : "secondary"}
          className="text-xs"
          onClick={() => void onSetActive()}
        >
          {isActive ? "Deactivate" : "Set active"}
        </Button>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Edit plan"
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          aria-label="Delete plan"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function CreatePlanForm({
  sessionOptions,
  onCancel,
  onCreate,
}: {
  sessionOptions: SessionOption[];
  onCancel: () => void;
  onCreate: (label: string, sessionIds: string[], schedule?: Plan["schedule"]) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [isScheduleEnabled, setIsScheduleEnabled] = useState(false);
  const [schedule, setSchedule] = useState<Partial<Record<number, string>>>({});

  const toggleSession = (id: string) => {
    setSelectedSessions((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      setSchedule((prevSchedule) => {
        const cleaned = { ...prevSchedule };
        for (const [day, session] of Object.entries(cleaned)) {
          if (session && !next.includes(session)) delete cleaned[Number(day)];
        }
        return cleaned;
      });
      return next;
    });
  };

  const handleCreate = async () => {
    if (!label.trim()) return;
    const finalSchedule =
      isScheduleEnabled && Object.keys(schedule).length > 0
        ? (schedule as Plan["schedule"])
        : undefined;
    await onCreate(label.trim(), selectedSessions, finalSchedule);
  };

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3 space-y-3">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Plan name (e.g. Strength block)"
        className="w-full bg-background/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
        autoFocus
        maxLength={40}
      />
      <div>
        <p className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Sessions in this plan</p>
        <div className="flex flex-wrap gap-2">
          {sessionOptions.map((opt) => (
            <SessionToggle
              key={opt.value}
              option={opt}
              selected={selectedSessions.includes(opt.value)}
              onToggle={() => toggleSession(opt.value)}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setIsScheduleEnabled((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-all",
          isScheduleEnabled
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-white/10 bg-white/5 text-slate-500 hover:text-slate-300 hover:border-white/20"
        )}
      >
        <CalendarDays size={11} />
        Assign sessions to days
      </button>
      {isScheduleEnabled && (
        <DayScheduleGrid
          selectedSessions={selectedSessions}
          sessionOptions={sessionOptions}
          schedule={schedule}
          onChange={setSchedule}
        />
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" className="gap-1" onClick={() => void handleCreate()} disabled={!label.trim()}>
          <Check size={13} />
          Create
        </Button>
        <Button size="sm" variant="ghost" className="gap-1" onClick={onCancel}>
          <X size={13} />
          Cancel
        </Button>
      </div>
    </div>
  );
}

export const PlansEditor: React.FC<PlansEditorProps> = ({
  plans,
  activePlanId,
  sessionOptions,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlan,
  onSetActivePlan,
}) => {
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (label: string, sessionIds: string[], schedule?: Plan["schedule"]) => {
    await onCreatePlan(label, sessionIds, schedule);
    setIsCreating(false);
  };

  return (
    <div className="space-y-3">
      {plans.length === 0 && !isCreating && (
        <div className="text-xs text-slate-500 space-y-1">
          <p>No plans yet.</p>
          <p>A plan groups a set of sessions (e.g. "Strength block: Push, Pull, Legs"). When you activate a plan, the session dropdown in the header only shows its sessions.</p>
        </div>
      )}

      {plans.map((plan) => (
        <PlanRow
          key={plan.id}
          plan={plan}
          isActive={plan.id === activePlanId}
          sessionOptions={sessionOptions}
          onSetActive={() => onSetActivePlan(plan.id === activePlanId ? null : plan.id)}
          onUpdate={(updates) => onUpdatePlan(plan.id, updates)}
          onDelete={() => onDeletePlan(plan.id)}
        />
      ))}

      {isCreating ? (
        <CreatePlanForm
          sessionOptions={sessionOptions}
          onCancel={() => setIsCreating(false)}
          onCreate={handleCreate}
        />
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="gap-2"
          onClick={() => setIsCreating(true)}
        >
          <Plus size={14} />
          New plan
        </Button>
      )}
    </div>
  );
};
