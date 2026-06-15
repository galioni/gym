import React from "react";
import { Lock } from "lucide-react";
import { cn } from "../../../utils";
import { useUserSettings, type AiProvider } from "../hooks/useUserSettings";
import { useSubscription } from "../../billing/hooks/useSubscription";

interface ProviderConfig {
  id: AiProvider;
  name: string;
  logo: React.ReactNode;
  selectedClass: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "google",
    name: "Gemini",
    logo: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor" aria-hidden="true">
        {/* Gemini 4-pointed star */}
        <path d="M12 2C11.5 6.5 10 9 7.5 11C5 13 2 12 2 12C2 12 5 11 7.5 13C10 15 11.5 17.5 12 22C12.5 17.5 14 15 16.5 13C19 11 22 12 22 12C22 12 19 13 16.5 11C14 9 12.5 6.5 12 2Z" />
      </svg>
    ),
    selectedClass: "border-blue-500/60 bg-blue-500/10 text-blue-300",
  },
  {
    id: "anthropic",
    name: "Claude",
    logo: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor" aria-hidden="true">
        {/* Anthropic A-mark */}
        <path d="M12 3L4.5 21H7.5L9 17.5H15L16.5 21H19.5L12 3ZM12 7.5L14 14.5H10L12 7.5Z" />
      </svg>
    ),
    selectedClass: "border-orange-500/60 bg-orange-500/10 text-orange-300",
  },
  {
    id: "openai",
    name: "ChatGPT",
    logo: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="currentColor" aria-hidden="true">
        {/* OpenAI hexagon mark */}
        <path d="M12 2L19.7 6.5V15.5L12 20L4.3 15.5V6.5L12 2ZM12 4.3L6.3 7.6V15.4L12 18.7L17.7 15.4V7.6L12 4.3Z" />
      </svg>
    ),
    selectedClass: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
  },
];

export const AiProviderSelector: React.FC = () => {
  const { subscription } = useSubscription();
  const { aiProvider, enabledProviders, isLoading, setAiProvider } = useUserSettings();

  const isPro =
    subscription.plan === "pro" &&
    (subscription.status === "active" || subscription.status === "trialing");

  const visible = PROVIDERS.filter((p) => enabledProviders.includes(p.id));
  if (visible.length <= 1) return null;

  return (
    <div className="mb-3">
      <div className="text-xs text-slate-500 mb-2">AI Provider</div>
      <div className="flex flex-wrap gap-2">
        {visible.map((provider) => {
          const isSelected = aiProvider === provider.id;
          const isLocked = !isPro && provider.id !== "google";
          return (
            <button
              key={provider.id}
              type="button"
              disabled={isLocked || isLoading}
              onClick={() => void setAiProvider(provider.id)}
              title={isLocked ? "Requires Pro plan" : provider.name}
              aria-pressed={isSelected}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-150 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/50",
                isSelected
                  ? provider.selectedClass
                  : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 hover:border-white/20",
                (isLocked || isLoading) && "opacity-40 cursor-not-allowed active:scale-100"
              )}
            >
              {provider.logo}
              {provider.name}
              {isLocked && <Lock size={10} className="ml-0.5 opacity-70" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
