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
    const unsubscribe = service.subscribe((nextSession) => {
      setSession(nextSession);
      setError(null);
      setIsLoading(false);
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
      session,
      error,
      signInWithGoogle,
      signOut,
    }),
    [error, isLoading, isWorking, session, signInWithGoogle, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
