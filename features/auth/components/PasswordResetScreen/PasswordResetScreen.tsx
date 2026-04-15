import React, { useState } from "react";
import { Dumbbell, Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "../../../../components/ui/Button";

interface PasswordResetScreenProps {
  isWorking: boolean;
  onUpdatePassword: (newPassword: string) => Promise<{ success: boolean }>;
}

export const PasswordResetScreen: React.FC<PasswordResetScreenProps> = ({
  isWorking,
  onUpdatePassword,
}) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    const result = await onUpdatePassword(password);
    setIsSubmitting(false);
    if (result.success) {
      setDone(true);
    } else {
      setError("Failed to update password. The link may have expired — request a new one.");
    }
  };

  const busy = isWorking || isSubmitting;

  return (
    <div className="min-h-screen bg-background flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-2 text-primary mb-2">
            <Dumbbell size={22} />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em]">Daily Grind</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Set a new password</h1>
          <p className="text-sm text-slate-400">Choose a password at least 8 characters long.</p>
        </div>

        <div className="rounded-[1.4rem] border border-white/10 bg-surface/60 backdrop-blur-xl p-5">
          {done ? (
            <div className="text-center space-y-3 py-2">
              <div className="text-sm text-green-300">Password updated. You are now signed in.</div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                required
              />
              {error && (
                <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-red-200">{error}</p>
              )}
              <Button variant="primary" size="sm" className="w-full gap-2" type="submit" disabled={busy}>
                <KeyRound size={14} />
                {busy ? "Updating..." : "Set password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
