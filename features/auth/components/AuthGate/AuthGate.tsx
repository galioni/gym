import React from "react";
import { GoogleSignInCard } from "../GoogleSignInCard/GoogleSignInCard";
import { UserMenu } from "../UserMenu/UserMenu";
import { useAuthSession } from "../../hooks/useAuthSession";

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { isLoading, isWorking, session, error, signInWithGoogle, signOut } = useAuthSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="rounded-2xl border border-white/10 bg-surface/70 px-6 py-4 text-sm text-slate-300">
          Restoring secure session...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgb(72_213_151_/_0.2),transparent_36%),radial-gradient(circle_at_78%_10%,rgb(255_122_26_/_0.28),transparent_30%),linear-gradient(160deg,rgb(10_13_19),rgb(6_10_17))]" />
        <GoogleSignInCard isWorking={isWorking} error={error} onSignIn={signInWithGoogle} />
      </div>
    );
  }

  return (
    <>
      <UserMenu
        email={session.user.email ?? "Signed in"}
        isWorking={isWorking}
        onSignOut={signOut}
      />
      {children}
    </>
  );
};
