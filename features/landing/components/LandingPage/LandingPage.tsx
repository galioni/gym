import React, { useState } from "react";
import { Dumbbell, Sparkles, ShieldCheck, Zap, RefreshCw, Mail, Eye, EyeOff, Check, X, Smartphone } from "lucide-react";
import { Button } from "../../../../components/ui/Button";

type AuthMode = "signin" | "signup" | "reset";

interface LandingPageProps {
  isWorking: boolean;
  error: string | null;
  onSignIn: () => Promise<void>;
  onSignInWithEmail: (email: string, password: string) => Promise<void>;
  onSignUpWithEmail: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  onResetPassword: (email: string) => Promise<{ sent: boolean }>;
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-2">
      <div className="text-primary">{icon}</div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="text-xs text-slate-400 leading-relaxed">{body}</div>
    </div>
  );
}

function friendlyAuthError(err: unknown, mode: AuthMode): string {
  const raw = err instanceof Error ? err.message : "Something went wrong.";
  const lower = raw.toLowerCase();
  if (lower.includes("email not confirmed")) {
    return "Your email isn't confirmed yet. Check your inbox for the confirmation link, then try signing in again.";
  }
  if (lower.includes("invalid login credentials") || lower.includes("invalid email or password")) {
    return "Incorrect email or password. Please try again.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return mode === "signup"
      ? "An account with this email already exists. Try signing in instead."
      : raw;
  }
  if (lower.includes("password should be at least")) {
    return "Password must be at least 8 characters.";
  }
  return raw;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  isWorking,
  error,
  onSignIn,
  onSignInWithEmail,
  onSignUpWithEmail,
  onResetPassword,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayError = localError ?? error;

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError("Email is required.");
      return;
    }
    if (authMode !== "reset" && !password) {
      setLocalError("Password is required.");
      return;
    }
    if (authMode === "signup" && password.length < 8) {
      setLocalError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === "reset") {
        const result = await onResetPassword(email.trim());
        if (result.sent) {
          setResetSent(true);
        }
      } else if (authMode === "signup") {
        const result = await onSignUpWithEmail(email.trim(), password);
        if (result.needsConfirmation) {
          setConfirmationPending(true);
          setIsSubmitting(false);
          return;
        }
      } else {
        await onSignInWithEmail(email.trim(), password);
      }
    } catch (err) {
      setLocalError(friendlyAuthError(err, authMode));
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (mode: AuthMode) => {
    setAuthMode(mode);
    setLocalError(null);
    setResetSent(false);
    setConfirmationPending(false);
    setPassword("");
  };

  const busy = isWorking || isSubmitting;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-slate-200">

      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgb(72_213_151_/_0.15),transparent_40%),radial-gradient(circle_at_80%_10%,rgb(255_122_26_/_0.22),transparent_35%),linear-gradient(160deg,rgb(10_13_19),rgb(6_10_17))]" />

      <div className="relative mx-auto max-w-6xl px-5 lg:px-10">

        {/* ── Above the fold: hero + auth ── */}
        <div className="lg:flex lg:gap-16 lg:items-center lg:min-h-screen py-14 sm:py-20 lg:py-12">

          {/* Left: hero copy */}
          <div className="text-center lg:text-left space-y-6 lg:flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              <Sparkles size={12} />
              AI-powered workout tracking
            </div>

            <div>
              <h1 className="display-title text-6xl sm:text-7xl lg:text-8xl text-white leading-none">Daily Grind</h1>
              <p className="mt-4 text-lg text-slate-300 leading-relaxed max-w-md mx-auto lg:mx-0">
                Tell the AI your goals. Get a personalised training plan in seconds. Track it every day — on any device.
              </p>
            </div>

            {/* Desktop-only value prop list */}
            <ul className="hidden lg:flex flex-col gap-3">
              {[
                "AI-generated plans — Gemini included free, Claude & ChatGPT for Pro",
                "Installable PWA — works on iOS, Android, and desktop",
                "Local-first storage, cloud sync across devices on Pro",
                "No streaks, no gamification — just your workout, tracked",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-slate-300">
                  <Check size={14} className="text-primary shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: auth box */}
          <div className="mt-10 lg:mt-0 lg:w-[22rem] lg:shrink-0 space-y-4">
            <div className="rounded-[1.4rem] border border-white/10 bg-surface/60 backdrop-blur-xl p-5 space-y-4">

              {/* Mode tabs */}
              {!resetSent && !confirmationPending && (
                <div className="flex rounded-xl border border-white/10 overflow-hidden text-sm font-medium">
                  {(["signin", "signup"] as AuthMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => switchMode(mode)}
                      className={`flex-1 py-2 transition-colors ${
                        authMode === mode
                          ? "bg-primary/20 text-primary"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {mode === "signin" ? "Sign in" : "Sign up"}
                    </button>
                  ))}
                </div>
              )}

              {confirmationPending ? (
                <div className="text-center space-y-3 py-2">
                  <div className="text-sm text-slate-200">
                    Check your email to confirm your account, then sign in.
                  </div>
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="text-xs text-primary hover:underline"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : resetSent ? (
                <div className="text-center space-y-3 py-2">
                  <div className="text-sm text-slate-200">Check your email for a password reset link.</div>
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="text-xs text-primary hover:underline"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : authMode === "reset" ? (
                <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-3">
                  <p className="text-sm text-slate-400">Enter your email and we'll send you a reset link.</p>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                    required
                  />
                  {displayError && (
                    <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-red-200">{displayError}</p>
                  )}
                  <Button variant="primary" size="sm" className="w-full" type="submit" disabled={busy}>
                    {busy ? "Sending..." : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="w-full text-xs text-slate-500 hover:text-slate-400 transition-colors"
                  >
                    Back to sign in
                  </button>
                </form>
              ) : (
                <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-3">
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                    required
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                      required
                      minLength={authMode === "signup" ? 8 : undefined}
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
                  {displayError && (
                    <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-red-200">{displayError}</p>
                  )}
                  <Button variant="primary" size="sm" className="w-full gap-2" type="submit" disabled={busy}>
                    <Mail size={14} />
                    {busy ? (authMode === "signup" ? "Creating account..." : "Signing in...") : (authMode === "signup" ? "Create account" : "Sign in")}
                  </Button>
                  {authMode === "signin" && (
                    <button
                      type="button"
                      onClick={() => switchMode("reset")}
                      className="w-full text-xs text-slate-500 hover:text-slate-400 transition-colors"
                    >
                      Forgot password?
                    </button>
                  )}
                </form>
              )}

              {authMode !== "reset" && !resetSent && !confirmationPending && (
                <>
                  <div className="relative flex items-center gap-3">
                    <div className="flex-1 border-t border-white/10" />
                    <span className="text-[11px] text-slate-600 uppercase tracking-widest">or</span>
                    <div className="flex-1 border-t border-white/10" />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => void onSignIn()}
                    disabled={busy}
                  >
                    <ShieldCheck size={14} />
                    {busy ? "Connecting..." : "Continue with Google"}
                  </Button>
                </>
              )}
            </div>

            <p className="text-center text-[11px] text-slate-600 uppercase tracking-[0.14em]">
              No credit card required
            </p>
          </div>
        </div>

        {/* ── Below the fold: features, pricing, how it works ── */}
        <div className="space-y-16 pb-20">

          {/* Features */}
          <div className="space-y-5">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Features</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <FeatureCard
                icon={<Sparkles size={20} />}
                title="AI-generated plans"
                body="Answer a few questions and get a complete training programme built for your goal, equipment, and schedule."
              />
              <FeatureCard
                icon={<ShieldCheck size={20} />}
                title="Your data, your device"
                body="Everything is stored locally first. Sync to cloud when you want it — never held hostage."
              />
              <FeatureCard
                icon={<Smartphone size={20} />}
                title="Mobile-first PWA"
                body="Installable on iOS and Android. Swipe to delete, tap to check — built for gym use, not desk use."
              />
              <FeatureCard
                icon={<Zap size={20} />}
                title="Simple by design"
                body="No streaks, no gamification, no bloat. Just your workout, tracked every day."
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-5">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Pricing</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">

              {/* Free */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Free</div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold text-white">$0</span>
                    <span className="text-sm text-slate-400 mb-1">forever</span>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {[
                    "Daily workout tracking",
                    "AI plan generation (Gemini)",
                    "Template & session editor",
                    "Backup export / import",
                    "Installable on iOS & Android",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-xs text-slate-300">
                      <Check size={12} className="text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                  <li className="flex items-center gap-2.5 text-xs text-slate-500">
                    <X size={12} className="shrink-0" />
                    Cloud sync
                  </li>
                </ul>
              </div>

              {/* Pro */}
              <div className="relative rounded-2xl border border-primary/40 bg-primary/5 p-6 space-y-5">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary bg-background border border-primary/30 rounded-full px-3 py-1">
                    Most popular
                  </span>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Pro</div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold text-white">$4.99</span>
                    <span className="text-sm text-slate-400 mb-1">/ month</span>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {[
                    "Everything in Free",
                    "Cloud sync across devices",
                    "Conflict resolution",
                    "Restore points & rollback",
                    "Choose your AI model (Claude, ChatGPT, Gemini)",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-xs text-slate-300">
                      <Check size={12} className="text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

            </div>
            <p className="text-center text-[11px] text-slate-600">
              No contracts. Cancel anytime. 7-day grace period on cancellation.
            </p>
          </div>

          {/* How it works */}
          <div className="space-y-5">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">How it works</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { step: "1", label: "Sign in", icon: <ShieldCheck size={18} /> },
                { step: "2", label: "Answer questions", icon: <Dumbbell size={18} /> },
                { step: "3", label: "AI builds your plan", icon: <Sparkles size={18} /> },
                { step: "4", label: "Track daily", icon: <RefreshCw size={18} /> },
              ].map(({ step, label, icon }) => (
                <div key={step} className="flex flex-col items-center gap-2 rounded-2xl border border-white/8 bg-white/4 px-3 py-4 text-center">
                  <div className="text-primary">{icon}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{step}</div>
                  <div className="text-xs text-slate-300 leading-snug">{label}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
