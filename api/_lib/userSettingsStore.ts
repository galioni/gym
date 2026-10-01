import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiProvider } from "./apiEnv.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export interface UserSettings {
  aiProvider?: AiProvider;
}

const PROVIDERS: ReadonlySet<string> = new Set(["google", "anthropic", "openai"]);

/**
 * Reads the AI provider the user picked (column `user_settings.ai_provider`). A missing row, an unknown value or an
 * unreachable database all mean "no preference": plan generation then uses the default provider.
 */
export async function getUserSettings(
  userId: string,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<UserSettings> {
  try {
    const { data, error } = await db
      .from("user_settings")
      .select("ai_provider")
      .eq("user_id", userId)
      .maybeSingle<{ ai_provider: string | null }>();
    if (error) throw new Error(error.message);
    const provider = data?.ai_provider;
    return provider && PROVIDERS.has(provider) ? { aiProvider: provider as AiProvider } : {};
  } catch (err) {
    console.warn("[userSettingsStore] Could not read user settings; using defaults", err);
    return {};
  }
}

/**
 * Saves the AI provider. Only this column is written: the same row also holds the active plan and plan details that the
 * browser syncs, and an upsert of just these two columns leaves those untouched.
 */
export async function setAiProvider(
  userId: string,
  provider: AiProvider,
  db: SupabaseClient = getSupabaseAdmin()
): Promise<void> {
  const { error } = await db
    .from("user_settings")
    .upsert({ user_id: userId, ai_provider: provider }, { onConflict: "user_id" });
  if (error) throw new Error(`Could not save AI provider: ${error.message}`);
}
