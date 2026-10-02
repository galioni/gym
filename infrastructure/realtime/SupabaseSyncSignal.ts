import { RealtimeClient } from "@supabase/realtime-js";
import { AuthTokenProvider } from "../../interfaces/auth/AuthTokenProvider";
import { SyncSignal } from "../../interfaces/sync/SyncSignal";
import { getRequiredSupabaseClientEnv } from "../auth/supabase/supabaseEnv";

/**
 * Listens on the private Broadcast channel `sync:<user id>` that the database writes to after each change (see
 * supabase/migrations/*_realtime_sync_signal.sql). The channel is private: Realtime checks the user's own token against a row
 * level security policy, so a user can only hear their own channel. Anything going wrong (no Realtime on this backend, a
 * refused channel, a dropped socket) is ignored: the app's other sync triggers keep working.
 */
export class SupabaseSyncSignal implements SyncSignal {
  public constructor(private readonly tokenProvider: AuthTokenProvider) {}

  public subscribe(userId: string, onChange: () => void): () => void {
    let client: RealtimeClient | null = null;
    try {
      const env = getRequiredSupabaseClientEnv();
      client = new RealtimeClient(`${env.url.replace(/^http/, "ws")}/realtime/v1`, {
        params: { apikey: env.anonKey },
        accessToken: () => this.tokenProvider.getAccessToken(),
      });
      const channel = client.channel(`sync:${userId}`, { config: { private: true } });
      channel.on("broadcast", { event: "changed" }, () => onChange());
      channel.subscribe();
    } catch (error) {
      console.warn("[sync-signal] could not start listening", error);
    }
    return () => {
      try {
        void client?.disconnect();
      } catch {
        // Already closed.
      }
    };
  }
}
