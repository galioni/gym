export interface SupabaseClientEnv {
  url: string;
  anonKey: string;
  redirectUrl: string;
}

function getRequiredViteEnv(name: string): string {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getRequiredSupabaseClientEnv(): SupabaseClientEnv {
  return {
    url: getRequiredViteEnv("VITE_SUPABASE_URL"),
    anonKey: getRequiredViteEnv("VITE_SUPABASE_ANON_KEY"),
    redirectUrl: getRequiredViteEnv("VITE_SUPABASE_REDIRECT_URL"),
  };
}
