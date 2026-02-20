import React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "../../../../components/ui/Button";

interface GoogleSignInCardProps {
  isWorking: boolean;
  error: string | null;
  onSignIn: () => Promise<void>;
}

export const GoogleSignInCard: React.FC<GoogleSignInCardProps> = ({
  isWorking,
  error,
  onSignIn,
}) => {
  return (
    <div className="w-full max-w-md rounded-[1.4rem] border border-white/20 bg-slate-950/70 p-6 shadow-[0_28px_80px_rgb(0_0_0_/_0.55)] backdrop-blur-xl">
      <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/90">Secure Access</p>
      <h1 className="mt-2 display-title text-4xl leading-none text-white">Daily Grind</h1>
      <p className="mt-3 text-sm text-slate-300">
        Sign in with your Google account to securely sync your workout data.
      </p>

      <Button
        variant="primary"
        size="md"
        className="mt-5 w-full gap-2"
        onClick={() => void onSignIn()}
        disabled={isWorking}
      >
        <ShieldCheck size={16} />
        {isWorking ? "Connecting..." : "Continue with Google"}
      </Button>

      <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-slate-500">
        Google OAuth provider only
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-2 text-xs text-red-200">
          {error}
        </p>
      )}
    </div>
  );
};
