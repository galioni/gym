import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AuthService } from "../../../application/auth/AuthService";
import { AuthSession } from "../../../interfaces/auth/AuthSession";
import { SupabaseAuthSessionRepository } from "../../../infrastructure/auth/supabase/SupabaseAuthSessionRepository";
import { AuthViewModel } from "../types/AuthViewModel";

const defaultAuthService = new AuthService(new SupabaseAuthSessionRepository());

export const AuthContext = React.createContext<AuthViewModel | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
  service?: AuthService;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  service = defaultAuthService,
}) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const current = await service.getSession();
        if (!cancelled) {
          setSession(current);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load auth session.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadSession();
    const unsubscribe = service.subscribe((nextSession, event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
        return;
      }
      setSession(nextSession);
      setError(null);
      setIsLoading(false);
      if (event === "SIGNED_IN") {
        setIsPasswordRecovery(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [service]);

  const signInWithGoogle = useCallback(async () => {
    setIsWorking(true);
    setError(null);
    try {
      await service.signInWithGoogle();
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Google sign-in failed.");
    } finally {
      setIsWorking(false);
    }
  }, [service]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setIsWorking(true);
    setError(null);
    try {
      await service.signInWithEmail(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      throw err;
    } finally {
      setIsWorking(false);
    }
  }, [service]);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    setIsWorking(true);
    setError(null);
    try {
      return await service.signUpWithEmail(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
      throw err;
    } finally {
      setIsWorking(false);
    }
  }, [service]);

  const updatePassword = useCallback(async (newPassword: string) => {
    setIsWorking(true);
    setError(null);
    try {
      await service.updatePassword(newPassword);
      setIsPasswordRecovery(false);
      return { success: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password update failed.");
      return { success: false };
    } finally {
      setIsWorking(false);
    }
  }, [service]);

  const resetPassword = useCallback(async (email: string) => {
    setIsWorking(true);
    setError(null);
    try {
      await service.resetPassword(email);
      return { sent: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed.");
      return { sent: false };
    } finally {
      setIsWorking(false);
    }
  }, [service]);

  const signOut = useCallback(async () => {
    setIsWorking(true);
    setError(null);
    try {
      await service.signOut();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Sign-out failed.");
    } finally {
      setIsWorking(false);
    }
  }, [service]);

  const value = useMemo<AuthViewModel>(
    () => ({
      isLoading,
      isWorking,
      isPasswordRecovery,
      session,
      error,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      updatePassword,
      signOut,
    }),
    [error, isLoading, isWorking, isPasswordRecovery, session, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, updatePassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
