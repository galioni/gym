import React, { useState } from "react";
import { Dumbbell, Loader2, Sparkles } from "lucide-react";
import { Templates } from "../../../../types";
import { Button } from "../../../../components/ui/Button";
import { useAuthSession } from "../../../auth/hooks/useAuthSession";
import { cn } from "../../../../utils";

interface OnboardingWizardProps {
  onComplete: (templates: Templates) => Promise<void>;
  onSkip: () => void;
}

type Goal = "strength" | "muscle" | "weight_loss" | "endurance" | "active";
type Experience = "beginner" | "intermediate" | "advanced";
type Equipment = "full_gym" | "home_gym" | "minimal" | "bodyweight";
type Duration = "30" | "45" | "60" | "90";
type BodyFocus =
  | "full_body"
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "core"
  | "legs"
  | "glutes"
  | "cardio";

const GOALS: { value: Goal; label: string; sub: string }[] = [
  { value: "strength", label: "Build strength", sub: "Compound lifts, progressive overload" },
  { value: "muscle", label: "Build muscle", sub: "Volume-focused, 8–15 reps" },
  { value: "weight_loss", label: "Lose weight", sub: "Mixed cardio + resistance" },
  { value: "endurance", label: "Improve endurance", sub: "Cardio & conditioning" },
  { value: "active", label: "Stay active", sub: "General fitness, feel good" },
];

const EXPERIENCE_LEVELS: { value: Experience; label: string; sub: string }[] = [
  { value: "beginner", label: "Beginner", sub: "Less than 1 year" },
  { value: "intermediate", label: "Intermediate", sub: "1–3 years" },
  { value: "advanced", label: "Advanced", sub: "3+ years" },
];

const EQUIPMENT_OPTIONS: { value: Equipment; label: string; sub: string }[] = [
  { value: "full_gym", label: "Full gym", sub: "Barbells, machines, cables" },
  { value: "home_gym", label: "Home gym", sub: "Dumbbells & barbell" },
  { value: "minimal", label: "Minimal", sub: "Bands & bodyweight" },
  { value: "bodyweight", label: "Bodyweight", sub: "No equipment" },
];

const BODY_FOCUS_OPTIONS: { value: BodyFocus; label: string }[] = [
  { value: "full_body", label: "Full body" },
  { value: "chest", label: "Chest" },
  { value: "back", label: "Back" },
  { value: "shoulders", label: "Shoulders" },
  { value: "arms", label: "Arms" },
  { value: "core", label: "Core / Abs" },
  { value: "legs", label: "Legs" },
  { value: "glutes", label: "Glutes" },
  { value: "cardio", label: "Cardio" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "60 min" },
  { value: "90", label: "90 min" },
];

function OptionCard<T extends string>({
  value,
  selected,
  label,
  sub,
  onClick,
}: {
  value: T;
  selected: boolean;
  label: string;
  sub?: string;
  onClick: (v: T) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "w-full text-left px-4 py-3 rounded-2xl border transition-all duration-150",
        selected
          ? "border-primary bg-primary/15 text-white"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-white/25 hover:bg-white/10"
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </button>
  );
}

function DayButton({ n, selected, onClick }: { n: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-11 w-11 rounded-xl text-sm font-bold border transition-all duration-150",
        selected
          ? "border-primary bg-primary/20 text-primary"
          : "border-white/10 bg-white/5 text-slate-400 hover:border-white/25"
      )}
    >
      {n}
    </button>
  );
}

const GENERATING_STEPS = [
  "Analysing your goals...",
  "Selecting exercises...",
  "Building your schedule...",
  "Finalising your plan...",
];

function GeneratingText() {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % GENERATING_STEPS.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, []);
  return <span>{GENERATING_STEPS[step]}</span>;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      {children}
    </div>
  );
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete, onSkip }) => {
  const { session } = useAuthSession();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [experience, setExperience] = useState<Experience | null>(null);
  const [daysPerWeek, setDaysPerWeek] = useState<number | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [duration, setDuration] = useState<Duration | null>(null);
  const [bodyFocus, setBodyFocus] = useState<BodyFocus[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleBodyFocus = (area: BodyFocus) => {
    setBodyFocus((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const canGenerate = goal && experience && daysPerWeek && equipment && duration;

  const handleGenerate = async () => {
    if (!canGenerate || !session) return;
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ goal, experience, daysPerWeek, equipment, duration, bodyFocus: bodyFocus.length > 0 ? bodyFocus : undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Plan generation failed. Please try again.");
      }

      const { templates } = await res.json() as { templates: Templates };
      await onComplete(templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">

        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-2 text-primary mb-2">
            <Dumbbell size={22} />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em]">Daily Grind</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Build your plan</h1>
          <p className="text-sm text-slate-400">Answer a few questions and we'll generate a training plan tailored to you.</p>
        </div>

        <div className="rounded-[1.4rem] border border-white/10 bg-surface/60 backdrop-blur-xl p-5 space-y-5">

          <Section label="What's your goal?">
            <div className="grid grid-cols-1 gap-2">
              {GOALS.map((g) => (
                <OptionCard key={g.value} value={g.value} selected={goal === g.value} label={g.label} sub={g.sub} onClick={setGoal} />
              ))}
            </div>
          </Section>

          <Section label="Training experience">
            <div className="grid grid-cols-3 gap-2">
              {EXPERIENCE_LEVELS.map((e) => (
                <OptionCard key={e.value} value={e.value} selected={experience === e.value} label={e.label} sub={e.sub} onClick={setExperience} />
              ))}
            </div>
          </Section>

          <Section label="Days per week">
            <div className="flex gap-2">
              {[2, 3, 4, 5, 6].map((n) => (
                <DayButton key={n} n={n} selected={daysPerWeek === n} onClick={() => setDaysPerWeek(n)} />
              ))}
            </div>
          </Section>

          <Section label="Equipment">
            <div className="grid grid-cols-2 gap-2">
              {EQUIPMENT_OPTIONS.map((e) => (
                <OptionCard key={e.value} value={e.value} selected={equipment === e.value} label={e.label} sub={e.sub} onClick={setEquipment} />
              ))}
            </div>
          </Section>

          <Section label="Body focus (optional — select all that apply)">
            <div className="grid grid-cols-3 gap-2">
              {BODY_FOCUS_OPTIONS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  onClick={() => toggleBodyFocus(b.value)}
                  className={cn(
                    "py-2.5 px-3 rounded-xl text-sm font-medium border transition-all duration-150 text-left",
                    bodyFocus.includes(b.value)
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-white/10 bg-white/5 text-slate-400 hover:border-white/25"
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </Section>

          <Section label="Session duration">
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDuration(d.value)}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all duration-150",
                    duration === d.value
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-white/10 bg-white/5 text-slate-400 hover:border-white/25"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Section>

          {error && (
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}

          <Button
            variant="primary"
            size="md"
            className="w-full gap-2"
            onClick={() => void handleGenerate()}
            disabled={!canGenerate || isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <GeneratingText />
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Generate my plan
              </>
            )}
          </Button>
        </div>

        <div className="text-center space-y-1">
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-400 transition-colors py-2"
          >
            Skip — I'll set up my plan manually
          </button>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            You can build templates in <span className="text-slate-500">Settings → Templates</span> and come back to generate a plan any time from <span className="text-slate-500">Settings → AI Plan</span>.
          </p>
        </div>
      </div>
    </div>
  );
};
