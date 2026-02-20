import { AuthSession } from "./AuthSession";

export type AuthSessionListener = (session: AuthSession | null) => void;

/**
 * Authentication boundary used by application-layer auth use cases.
 */
export interface AuthSessionRepository {
  getSession(): Promise<AuthSession | null>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: AuthSessionListener): () => void;
}
