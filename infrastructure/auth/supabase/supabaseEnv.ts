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

/**
 * Where Supabase sends the browser after Google sign-in, sign-up confirmation and password reset.
 * In a browser this is the origin the user is on, so a Vercel preview returns to the preview (not to a fixed
 * production address) and the allow-list in Supabase is the only thing that has to know the domains.
 * VITE_SUPABASE_REDIRECT_URL is only the fallback when there is no window.
 */
function getRedirectUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    return window.location.origin;
  }
  return getRequiredViteEnv("VITE_SUPABASE_REDIRECT_URL");
}

export function getRequiredSupabaseClientEnv(): SupabaseClientEnv {
  return {
    url: getRequiredViteEnv("VITE_SUPABASE_URL"),
    anonKey: getRequiredViteEnv("VITE_SUPABASE_ANON_KEY"),
    redirectUrl: getRedirectUrl(),
  };
}
