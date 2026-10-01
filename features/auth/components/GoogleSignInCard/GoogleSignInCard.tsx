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
    <div className="w-full max-w-md rounded-[1.4rem] border border-borderStrong bg-overlay/70 p-6 shadow-pop backdrop-blur-xl">
      <p className="text-[11px] uppercase tracking-[0.2em] text-successText/90">Secure Access</p>
      <h1 className="mt-2 display-title text-4xl leading-none text-label">Daily Grind</h1>
      <p className="mt-3 text-sm text-labelSecondary">
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

      <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-labelTertiary">
        Google OAuth provider only
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-2 text-xs text-dangerText">
          {error}
        </p>
      )}
    </div>
  );
};
