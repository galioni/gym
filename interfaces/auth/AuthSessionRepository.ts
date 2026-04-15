import { AuthSession } from "./AuthSession";

export type AuthSessionListener = (session: AuthSession | null, event?: string) => void;

/**
 * Authentication boundary used by application-layer auth use cases.
 */
export interface AuthSessionRepository {
  getSession(): Promise<AuthSession | null>;
  signInWithGoogle(): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  resetPassword(email: string): Promise<void>;
  updatePassword(newPassword: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: AuthSessionListener): () => void;
}
