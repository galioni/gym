import { Session } from "@supabase/supabase-js";
import { AuthSession } from "../../../interfaces/auth/AuthSession";
import {
  AuthSessionListener,
  AuthSessionRepository,
} from "../../../interfaces/auth/AuthSessionRepository";
import { createSupabaseClient } from "./createSupabaseClient";
import { getRequiredSupabaseClientEnv } from "./supabaseEnv";

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) {
    return null;
  }

  return {
    accessToken: session.access_token,
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
      displayName:
        typeof session.user.user_metadata?.full_name === "string"
          ? session.user.user_metadata.full_name
          : typeof session.user.user_metadata?.name === "string"
            ? session.user.user_metadata.name
            : null,
      avatarUrl:
        typeof session.user.user_metadata?.avatar_url === "string"
          ? session.user.user_metadata.avatar_url
          : null,
    },
  };
}

export class SupabaseAuthSessionRepository implements AuthSessionRepository {
  public async getSession(): Promise<AuthSession | null> {
    const client = createSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }
    return toAuthSession(data.session);
  }

  public async signInWithEmail(email: string, password: string): Promise<void> {
    const client = createSupabaseClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(error.message);
    }
  }

  public async signUpWithEmail(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const client = createSupabaseClient();
    const { redirectUrl } = getRequiredSupabaseClientEnv();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl },
    });
    if (error) {
      throw new Error(error.message);
    }
    // If identities is empty the email already exists (Supabase returns 200 but creates no identity).
    const needsConfirmation = !data.session;
    return { needsConfirmation };
  }

  public async updatePassword(newPassword: string): Promise<void> {
    const client = createSupabaseClient();
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      throw new Error(error.message);
    }
  }

  public async resetPassword(email: string): Promise<void> {
    const client = createSupabaseClient();
    const redirectTo = getRequiredSupabaseClientEnv().redirectUrl;
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      throw new Error(error.message);
    }
  }

  public async signInWithGoogle(): Promise<void> {
    const client = createSupabaseClient();
    const redirectTo = getRequiredSupabaseClientEnv().redirectUrl;
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });
    if (error) {
      throw new Error(error.message);
    }
  }

  public async signOut(): Promise<void> {
    const client = createSupabaseClient();
    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  public subscribe(listener: AuthSessionListener): () => void {
    const client = createSupabaseClient();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      listener(toAuthSession(session), event);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }
}
