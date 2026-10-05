import {
  getAppleIapConfig,
  getGooglePlayConfig,
  getStoreProProductIds,
  type AppleIapConfig,
  type GooglePlayConfig,
} from "./storeEnv.js";
import {
  getStoreSubscriptionUser,
  getSubscription,
  hasProAccess,
  setStoreSubscription,
  type SubscriptionInfo,
} from "./subscriptionGuard.js";
import {
  lookupAppleSubscription,
  lookupGoogleSubscription,
  storeStateGrantsPro,
  StoreLookupError,
  type StorePlatform,
  type StoreSubscriptionState,
} from "./storeVerification.js";

/** The outside world this module needs, so tests can supply fakes. */
export interface StoreDeps {
  lookup: (platform: StorePlatform, token: string) => Promise<StoreSubscriptionState>;
  getSubscription: typeof getSubscription;
  getStoreSubscriptionUser: typeof getStoreSubscriptionUser;
  setStoreSubscription: typeof setStoreSubscription;
  now: () => number;
}

/** What the person is told when store billing is not set up yet. */
export const STORE_NOT_CONFIGURED = "Subscriptions in the app are not available yet.";

export function isStoreBillingConfigured(platform: StorePlatform): boolean {
  if (getStoreProProductIds().size === 0) return false;
  return platform === "apple" ? getAppleIapConfig() !== null : getGooglePlayConfig() !== null;
}

function defaultLookup(platform: StorePlatform, token: string): Promise<StoreSubscriptionState> {
  const products = getStoreProProductIds();
  if (platform === "apple") {
    const config: AppleIapConfig | null = getAppleIapConfig();
    if (!config || products.size === 0) throw new StoreLookupError("unavailable", STORE_NOT_CONFIGURED);
    return lookupAppleSubscription(token, config, products);
  }
  const config: GooglePlayConfig | null = getGooglePlayConfig();
  if (!config || products.size === 0) throw new StoreLookupError("unavailable", STORE_NOT_CONFIGURED);
  return lookupGoogleSubscription(token, config, products);
}

export const defaultStoreDeps: StoreDeps = {
  lookup: defaultLookup,
  getSubscription,
  getStoreSubscriptionUser,
  setStoreSubscription,
  now: Date.now,
};

export type VerifyResult =
  | { ok: true; subscription: SubscriptionInfo }
  | { ok: false; status: 403 | 404 | 409 | 422 | 503; error: string };

function statusFor(state: StoreSubscriptionState): string {
  if (storeStateGrantsPro(state)) return state.access === "grace" ? "past_due" : "active";
  switch (state.access) {
    case "retry":
      return "past_due";
    case "revoked":
      return "revoked";
    case "pending":
      return "incomplete";
    default:
      return "expired";
  }
}

async function save(userId: string, state: StoreSubscriptionState, deps: StoreDeps): Promise<SubscriptionInfo> {
  const info = {
    plan: storeStateGrantsPro(state, deps.now()) ? ("pro" as const) : ("free" as const),
    status: statusFor(state),
    currentPeriodEnd: state.expiresAt,
  };
  await deps.setStoreSubscription(userId, state.platform, state.transactionId, info);
  return { ...info, stripeCustomerId: null, source: state.platform };
}

function lookupFailure(error: unknown): VerifyResult | null {
  if (!(error instanceof StoreLookupError)) return null;
  switch (error.reason) {
    case "not_found":
      return { ok: false, status: 404, error: "The store does not know this purchase." };
    case "unknown_product":
    case "wrong_app":
      return { ok: false, status: 422, error: "This purchase is not a Daily Grind Pro subscription." };
    default:
      return { ok: false, status: 503, error: error.message === STORE_NOT_CONFIGURED ? STORE_NOT_CONFIGURED : "The store could not be reached. Please try again." };
  }
}

/**
 * The app finished a purchase (or a restore) and hands over its id. Looks it up with the store, checks it belongs to this
 * account, and records it. Returns the account's resulting subscription.
 */
export async function verifyStorePurchase(
  userId: string,
  platform: StorePlatform,
  token: string,
  deps: StoreDeps = defaultStoreDeps
): Promise<VerifyResult> {
  const existing = await deps.getSubscription(userId);

  let state: StoreSubscriptionState;
  try {
    state = await deps.lookup(platform, token);
  } catch (error) {
    const failure = lookupFailure(error);
    if (failure) return failure;
    throw error;
  }

  // A purchase is tied to the account that made it (the app sets the account id when it starts the purchase), so a copied
  // token cannot hand one person's subscription to another account.
  if (state.accountId !== userId.toLowerCase()) {
    return { ok: false, status: 403, error: "This purchase belongs to a different account." };
  }

  const owner = await deps.getStoreSubscriptionUser(platform, state.transactionId);
  if (owner && owner !== userId) {
    return { ok: false, status: 409, error: "This purchase is already linked to another account." };
  }

  // Never bill twice: someone already paying elsewhere is told where to manage that subscription.
  const paidElsewhere = hasProAccess(existing) && existing.source && existing.source !== platform;
  if (paidElsewhere && storeStateGrantsPro(state, deps.now())) {
    const where = existing.source === "stripe" ? "on the web" : existing.source === "apple" ? "with the App Store" : "with Google Play";
    return { ok: false, status: 409, error: `You already have an active subscription ${where}. Manage it there before subscribing again.` };
  }

  return { ok: true, subscription: await save(userId, state, deps) };
}

/**
 * A store told us something changed. The notification is only a nudge: the current state is fetched from the store and
 * applied to the account the purchase is linked to. Unknown purchases are ignored (the app will verify them when the
 * person opens it). Returns whether a subscription was updated.
 */
export async function refreshStorePurchase(platform: StorePlatform, token: string, deps: StoreDeps = defaultStoreDeps): Promise<boolean> {
  let state: StoreSubscriptionState;
  try {
    state = await deps.lookup(platform, token);
  } catch (error) {
    // The store has no such purchase, or it is not ours: nothing to update, and retrying cannot help.
    if (error instanceof StoreLookupError && error.reason !== "unavailable") return false;
    throw error;
  }

  let userId = await deps.getStoreSubscriptionUser(platform, state.transactionId);
  if (!userId && state.previousTransactionId) {
    // Google issued a new token for a resubscribe or plan change: follow it from the one we know.
    userId = await deps.getStoreSubscriptionUser(platform, state.previousTransactionId);
  }
  if (!userId) return false;
  if (state.accountId !== userId.toLowerCase()) return false;

  await save(userId, state, deps);
  return true;
}
