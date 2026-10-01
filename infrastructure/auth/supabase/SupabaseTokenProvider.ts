import { AuthTokenProvider } from "../../../interfaces/auth/AuthTokenProvider";
import { createSupabaseClient } from "./createSupabaseClient";
import type { AuthIdentityProvider } from "../../supabase/PostgrestRowGateway";

export class SupabaseTokenProvider implements AuthTokenProvider, AuthIdentityProvider {
  public async getAccessToken(): Promise<string | null> {
    const client = createSupabaseClient();
    const { data, error } = await client.getSession();
    if (error) {
      throw new Error(error.message);
    }
    return data.session?.access_token ?? null;
  }

  public async getUserId(): Promise<string | null> {
    const client = createSupabaseClient();
    const { data, error } = await client.getSession();
    if (error) {
      throw new Error(error.message);
    }
    return data.session?.user.id ?? null;
  }
}
