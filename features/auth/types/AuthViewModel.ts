import { AuthSession } from "../../../interfaces/auth/AuthSession";

export interface AuthViewModel {
  isLoading: boolean;
  isWorking: boolean;
  session: AuthSession | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}
