import React from "react";
import { LandingPage } from "../../../landing/components/LandingPage/LandingPage";
import { PasswordResetScreen } from "../PasswordResetScreen/PasswordResetScreen";
import { useAuthSession } from "../../hooks/useAuthSession";

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { isLoading, isWorking, isPasswordRecovery, session, error, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, updatePassword, signOut } = useAuthSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="rounded-2xl border border-white/10 bg-surface/70 px-6 py-4 text-sm text-slate-300">
          Restoring secure session...
        </div>
      </div>
    );
  }

  if (isPasswordRecovery) {
    return <PasswordResetScreen isWorking={isWorking} onUpdatePassword={updatePassword} />;
  }

  if (!session) {
    return (
      <LandingPage
        isWorking={isWorking}
        error={error}
        onSignIn={signInWithGoogle}
        onSignInWithEmail={signInWithEmail}
        onSignUpWithEmail={signUpWithEmail}
        onResetPassword={resetPassword}
      />
    );
  }

  return <>{children}</>;
};
