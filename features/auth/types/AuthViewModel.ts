import { AuthSession } from "../../../interfaces/auth/AuthSession";

export interface AuthViewModel {
  isLoading: boolean;
  isWorking: boolean;
  isPasswordRecovery: boolean;
  session: AuthSession | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  resetPassword: (email: string) => Promise<{ sent: boolean }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean }>;
  signOut: () => Promise<void>;
}
