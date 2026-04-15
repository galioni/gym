import React, { useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Plan, SessionOption } from "../../../../types";
import { Button } from "../../../../components/ui/Button";
import { cn } from "../../../../utils";

interface PlansEditorProps {
  plans: Plan[];
  activePlanId: string | null;
  sessionOptions: SessionOption[];
  onCreatePlan: (label: string, sessionIds: string[]) => Promise<Plan>;
  onUpdatePlan: (id: string, updates: Partial<Pick<Plan, "label" | "sessionIds">>) => Promise<void>;
  onDeletePlan: (id: string) => Promise<void>;
  onSetActivePlan: (id: string | null) => Promise<void>;
}

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
  onUpdate: (updates: Partial<Pick<Plan, "label" | "sessionIds">>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(plan.label);
  const [selectedSessions, setSelectedSessions] = useState<string[]>(plan.sessionIds);

  const toggleSession = (id: string) => {
    setSelectedSessions((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!label.trim()) return;
    await onUpdate({ label: label.trim(), sessionIds: selectedSessions });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLabel(plan.label);
    setSelectedSessions(plan.sessionIds);
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

  const sessionLabels = plan.sessionIds
    .map((id) => sessionOptions.find((o) => o.value === id)?.label ?? id)
    .join(", ");

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
        </div>
        <div className="text-xs text-slate-500 truncate">
          {plan.sessionIds.length === 0 ? "No sessions" : sessionLabels}
        </div>
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
  onCreate: (label: string, sessionIds: string[]) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);

  const toggleSession = (id: string) => {
    setSelectedSessions((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (!label.trim()) return;
    await onCreate(label.trim(), selectedSessions);
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

  const handleCreate = async (label: string, sessionIds: string[]) => {
    await onCreatePlan(label, sessionIds);
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
