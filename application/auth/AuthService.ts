import { AuthSession } from "../../interfaces/auth/AuthSession";
import {
  AuthSessionListener,
  AuthSessionRepository,
} from "../../interfaces/auth/AuthSessionRepository";

/**
 * Application-layer authentication service with provider-agnostic contracts.
 */
export class AuthService {
  public constructor(private readonly repository: AuthSessionRepository) {}

  public async getSession(): Promise<AuthSession | null> {
    return this.repository.getSession();
  }

  public async signInWithGoogle(): Promise<void> {
    await this.repository.signInWithGoogle();
  }

  public async signInWithEmail(email: string, password: string): Promise<void> {
    await this.repository.signInWithEmail(email, password);
  }

  public async signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    return this.repository.signUpWithEmail(email, password);
  }

  public async resetPassword(email: string): Promise<void> {
    await this.repository.resetPassword(email);
  }

  public async updatePassword(newPassword: string): Promise<void> {
    await this.repository.updatePassword(newPassword);
  }

  public async signOut(): Promise<void> {
    await this.repository.signOut();
  }

  public subscribe(listener: AuthSessionListener): () => void {
    return this.repository.subscribe(listener);
  }
}
