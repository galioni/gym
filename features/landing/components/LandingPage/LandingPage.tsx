import React, { useState, useEffect, useRef } from "react";
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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-2 transition-transform duration-300 hover:-translate-y-1 hover:border-white/20">
      <div className="text-primary">{icon}</div>
      <div className="text-base font-semibold text-white">{title}</div>
      <div className="text-base text-slate-400 leading-relaxed">{body}</div>
    </div>
  );
}

function RevealSection({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.08 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${visible ? "motion-rise" : "opacity-0"} ${className ?? ""}`}>
      {children}
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
    <div data-theme="recovery-light" className="relative min-h-screen overflow-hidden bg-background text-slate-200">

      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgb(10_13_19),rgb(6_10_17))]" />
      <div className="motion-orb-a pointer-events-none absolute -top-20 -left-20 w-[600px] h-[600px] rounded-full bg-[radial-gradient(circle,rgb(72_213_151_/_0.12),transparent_65%)]" />
      <div className="motion-orb-b pointer-events-none absolute -top-10 right-0 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,rgb(111_208_255_/_0.15),transparent_65%)]" />

      <div className="relative mx-auto max-w-6xl px-5 lg:px-10">

        {/* ── Above the fold: hero + auth ── */}
        <div className="lg:flex lg:gap-16 lg:items-start py-14 sm:py-20 lg:py-16">

          {/* Left: hero copy */}
          <div className="text-center lg:text-left space-y-6 lg:flex-1">
            <div className="motion-rise inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
              <Sparkles size={12} />
              AI-powered workout tracking
            </div>

            <div className="motion-rise motion-delay-1">
              <h1 className="display-title text-6xl sm:text-7xl lg:text-8xl text-white leading-none">Daily Grind</h1>
              <p className="mt-4 text-lg text-slate-300 leading-relaxed max-w-md mx-auto lg:mx-0">
                Tell the AI your goals. Get a personalised training plan in seconds. Track it every day — on any device.
              </p>
            </div>

            {/* Desktop-only value prop list */}
            <ul className="motion-rise motion-delay-2 hidden lg:flex flex-col gap-3">
              {[
                "AI-generated plans — Gemini included free, Claude & ChatGPT for Pro",
                "Installable PWA — works on iOS, Android, and desktop",
                "Local-first storage, cloud sync across devices on Pro",
                "No streaks, no gamification — just your workout, tracked",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-base text-slate-300">
                  <Check size={16} className="text-primary shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: auth box */}
          <div className="motion-rise motion-delay-2 mt-10 lg:mt-0 lg:w-[22rem] lg:shrink-0 space-y-4">
            <div className="rounded-[1.4rem] border border-white/10 bg-surface/60 backdrop-blur-xl p-5 space-y-4">

              {/* Mode tabs */}
              {!resetSent && !confirmationPending && (
                <div className="flex rounded-xl border border-white/10 overflow-hidden text-base font-medium">
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
                  <div className="text-base text-slate-200">
                    Check your email to confirm your account, then sign in.
                  </div>
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="text-sm text-primary hover:underline"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : resetSent ? (
                <div className="text-center space-y-3 py-2">
                  <div className="text-base text-slate-200">Check your email for a password reset link.</div>
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="text-sm text-primary hover:underline"
                  >
                    Back to sign in
                  </button>
                </div>
              ) : authMode === "reset" ? (
                <form onSubmit={(e) => void handleEmailSubmit(e)} className="space-y-3">
                  <p className="text-base text-slate-400">Enter your email and we'll send you a reset link.</p>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 text-base text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                    required
                  />
                  {displayError && (
                    <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-red-200">{displayError}</p>
                  )}
                  <Button variant="primary" size="md" className="w-full text-base py-3" type="submit" disabled={busy}>
                    {busy ? "Sending..." : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="w-full text-sm text-slate-500 hover:text-slate-400 transition-colors"
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
                    className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 text-base text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
                    required
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-background/70 border border-white/10 rounded-xl px-3 py-2.5 pr-10 text-base text-slate-200 placeholder-slate-600 focus:ring-2 focus:ring-primary/50 outline-none"
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
                    <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-red-200">{displayError}</p>
                  )}
                  <Button variant="primary" size="md" className="w-full gap-2 text-base py-3" type="submit" disabled={busy}>
                    <Mail size={14} />
                    {busy ? (authMode === "signup" ? "Creating account..." : "Signing in...") : (authMode === "signup" ? "Create account" : "Sign in")}
                  </Button>
                  {authMode === "signin" && (
                    <button
                      type="button"
                      onClick={() => switchMode("reset")}
                      className="w-full text-sm text-slate-500 hover:text-slate-400 transition-colors"
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
                    <span className="text-sm text-slate-600 uppercase tracking-widest">or</span>
                    <div className="flex-1 border-t border-white/10" />
                  </div>
                  <Button
                    variant="secondary"
                    size="md"
                    className="w-full gap-2 text-base py-3"
                    onClick={() => void onSignIn()}
                    disabled={busy}
                  >
                    <ShieldCheck size={14} />
                    {busy ? "Connecting..." : "Continue with Google"}
                  </Button>
                </>
              )}
            </div>

            <p className="text-center text-sm text-slate-600 uppercase tracking-[0.14em]">
              No credit card required
            </p>
          </div>
        </div>

        {/* ── Below the fold: features, pricing, how it works ── */}
        <div className="space-y-16 pb-20">

          {/* Features */}
          <RevealSection className="space-y-5">
            <p className="text-center text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Features</p>
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
          </RevealSection>

          {/* Pricing */}
          <RevealSection className="space-y-5">
            <p className="text-center text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Pricing</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">

              {/* Free */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.14em] text-slate-400">Free</div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold text-white">$0</span>
                    <span className="text-base text-slate-400 mb-1">forever</span>
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
                    <li key={f} className="flex items-center gap-2.5 text-base text-slate-300">
                      <Check size={13} className="text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                  <li className="flex items-center gap-2.5 text-base text-slate-500">
                    <X size={12} className="shrink-0" />
                    Cloud sync
                  </li>
                </ul>
              </div>

              {/* Pro */}
              <div className="relative rounded-2xl border border-primary/40 bg-primary/5 p-6 space-y-5">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <span className="text-sm font-bold uppercase tracking-widest text-primary bg-background border border-primary/30 rounded-full px-3 py-1">
                    Most popular
                  </span>
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Pro</div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold text-white">$4.99</span>
                    <span className="text-base text-slate-400 mb-1">/ month</span>
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
                    <li key={f} className="flex items-center gap-2.5 text-base text-slate-300">
                      <Check size={13} className="text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

            </div>
            <p className="text-center text-sm text-slate-600">
              No contracts. Cancel anytime. 7-day grace period on cancellation.
            </p>
          </RevealSection>

          {/* How it works */}
          <RevealSection className="space-y-8">
            <div className="text-center space-y-2">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">How it works</p>
              <p className="text-slate-300 text-lg">From zero to training in under two minutes.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 relative">
              {/* Connector line — desktop only */}
              <div className="hidden sm:block absolute top-8 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

              {[
                { step: "1", label: "Create an account", desc: "Sign up free in seconds — no credit card needed.", icon: <ShieldCheck size={22} /> },
                { step: "2", label: "Tell us your goals", desc: "Equipment, schedule, experience level — a few quick questions.", icon: <Dumbbell size={22} /> },
                { step: "3", label: "Get your plan", desc: "The AI builds a full training programme tailored to you.", icon: <Sparkles size={22} /> },
                { step: "4", label: "Track every session", desc: "Open the app, check off your sets. That's the whole habit.", icon: <RefreshCw size={22} /> },
              ].map(({ step, label, desc, icon }) => (
                <div key={step} className="flex flex-col items-center text-center gap-3 px-4 py-6 rounded-2xl border border-white/8 bg-white/4 transition-transform duration-300 hover:-translate-y-1 hover:border-white/20">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                      {icon}
                    </div>
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-black text-[10px] font-black flex items-center justify-center">
                      {step}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-lg font-semibold text-white">{label}</div>
                    <div className="text-base text-slate-400 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </RevealSection>

        </div>
      </div>
    </div>
  );
};
