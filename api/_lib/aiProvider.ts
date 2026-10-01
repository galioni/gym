import type { AiProvider } from "./apiEnv.js";

const DEFAULT_PROVIDER: AiProvider = "google";

/**
 * The provider plan generation will really use: the saved choice only counts for a Pro user and only while that provider
 * is switched on; otherwise the default. The saved value lives in a table the user can write to directly, so this is where
 * the Pro rule is enforced, not at the moment of saving.
 */
export function resolveAiProvider(
  requested: AiProvider | undefined,
  isPro: boolean,
  enabledProviders: readonly AiProvider[]
): AiProvider {
  return requested && isPro && enabledProviders.includes(requested) ? requested : DEFAULT_PROVIDER;
}
