/**
 * The database schema as TypeScript, generated from the live project (Supabase CLI: `supabase gen types typescript`, or the
 * dashboard's API docs). Regenerate after every migration. Nothing imports this to talk to the database; it exists so that
 * `databaseTypes.testSupport.ts` can fail the type-check when the hand-written row types in `postgresRows.ts` drift from
 * the real columns.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      plans: {
        Row: {
          deleted_at: string | null;
          id: string;
          label: string;
          position: number;
          schedule: Json | null;
          session_ids: Json;
          updated_at: string;
          user_id: string;
        };
      };
      templates: {
        Row: {
          deleted_at: string | null;
          focus: string | null;
          label: string | null;
          main: Json;
          position: number;
          session_type: string;
          source: string | null;
          updated_at: string;
          user_id: string;
          video_url: string | null;
          warmup: Json;
        };
      };
      user_settings: {
        Row: {
          active_plan_id: string | null;
          ai_provider: string | null;
          onboarded_at: string | null;
          plan_meta: Json | null;
          plan_params: Json | null;
          updated_at: string;
          user_id: string;
        };
      };
      workout_days: {
        Row: {
          check_notes: string;
          day: string;
          deleted_at: string | null;
          deleted_hash: string | null;
          main: Json;
          main_notes: string;
          main_timer_ms: number;
          session_type: string;
          updated_at: string;
          user_id: string;
          warmup: Json;
          warmup_notes: string;
          warmup_timer_ms: number;
          weight: string;
        };
      };
    };
    Functions: {
      begin_sync: { Args: never; Returns: { allowed: boolean; next_available_at: string; window_ends_at: string }[] };
      sync_allowance: {
        Args: never;
        Returns: { enforced: boolean; is_pro: boolean; next_available_at: string; window_ends_at: string }[];
      };
    };
  };
};
