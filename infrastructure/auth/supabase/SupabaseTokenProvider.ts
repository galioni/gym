import { AuthTokenProvider } from "../../../interfaces/auth/AuthTokenProvider";
import { createSupabaseClient } from "./createSupabaseClient";

export class SupabaseTokenProvider implements AuthTokenProvider {
  public async getAccessToken(): Promise<string | null> {
    const client = createSupabaseClient();
    const { data, error } = await client.getSession();
    if (error) {
      throw new Error(error.message);
    }
    return data.session?.access_token ?? null;
  }
}
