# Store billing (App Store and Google Play)

Pro can be bought inside the mobile app. Everything is built and tested, and switched off until the store accounts exist:
with no configuration the API answers `503 "Subscriptions in the app are not available yet."` and the app shows
"Pro isn't available to buy right now". Stripe on the web is untouched.

## How it works

```
 app                         API (Vercel)                          store
  | buy (accountId = user id)    |                                    |
  |----------------------------------------------------------------->|  purchase sheet
  |<-----------------------------------------------------------------|  transaction id / purchase token
  | POST /api/store-purchase     |                                    |
  |  {platform, token}  -------->| ask the store about this token --->|  App Store Server API / Play Developer API
  |                              |<-- state, product, expiry, account-|
  |                              | account matches? not linked to someone else? not already paying elsewhere?
  |                              | write subscriptions row (billing_source = apple | google)
  |<---- subscription -----------|
  | tell the store "delivered"   |   (Apple: finish transaction. Google: acknowledge, or it refunds after 3 days)
```

- **The server believes only the store.** The app sends an id; the plan, expiry and owner come from the store's API,
  authenticated with our credentials.
- **A purchase belongs to one account.** The app attaches the signed-in user id (Apple `appAccountToken`, Google
  `obfuscatedAccountId`); the server refuses a purchase whose account id is not the caller's, and a unique index keeps
  one purchase from being linked to two accounts.
- **No double billing.** Active on Stripe means a store purchase is refused (409), and active in a store means a Stripe
  checkout is refused. The Free paywall is also hidden for Stripe subscribers.
- **Renewals, cancellations, refunds** arrive at `/api/store-notifications`. A notification is only a nudge: the server
  re-reads the purchase from the store and applies that, so a forged notification changes nothing.
- **A purchase is only "delivered" after the server accepted it.** If the server or network fails, the purchase stays
  unfinished and is confirmed on the next app start. On Google an unacknowledged purchase is refunded after 3 days.

## What you need to set up

### 1. Database

Apply `supabase/migrations/20261003120000_store_billing.sql` (additive: two nullable columns and a partial unique index).
Reminder: the Supabase GitHub integration applies migrations to production when the PR merges to main. Old code keeps
working with the new columns.

### 2. Product

Create one auto-renewing subscription in both stores with the **same product id** (for example `dailygrind_pro_monthly`).

- **App Store Connect:** app > Subscriptions > a subscription group > the product. Add price, localisation, review
  screenshot. Then *Users and Access > Integrations > In-App Purchase*: generate a key (download the `.p8`, note the Key ID
  and the Issuer ID). App Store Connect > App > App Information > *App Store Server Notifications*: set the production and
  sandbox URL (version 2) to `https://<your-domain>/api/store-notifications?platform=apple&token=<STORE_WEBHOOK_SECRET>`.
- **Google Play Console:** Monetize > Subscriptions > create the product and a base plan (and an offer if wanted).
  Create a service account in Google Cloud, grant it *View financial data* and *Manage orders and subscriptions* in Play
  Console > Users and permissions, and download its JSON key. Enable the Google Play Android Developer API. For
  notifications: Monetization setup > Real-time developer notifications: create a Pub/Sub topic, give
  `google-play-developer-notifications@system.gserviceaccount.com` the Publisher role on it, and add a **push**
  subscription to `https://<your-domain>/api/store-notifications?platform=google&token=<STORE_WEBHOOK_SECRET>`.

The app must be uploaded to a test track (Play) and TestFlight (Apple) before purchases work at all.

### 3. Vercel environment variables (all optional until you are ready)

| Variable | Value |
| --- | --- |
| `STORE_PRO_PRODUCT_IDS` | the product id(s) that grant Pro, comma separated |
| `STORE_WEBHOOK_SECRET` | a long random string, also placed in the two notification URLs above |
| `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID` | from the In-App Purchase key |
| `APPLE_IAP_PRIVATE_KEY` | contents of the `.p8` file (literal `\n` between lines is accepted) |
| `APPLE_BUNDLE_ID` | the **iOS** bundle id, currently `com.dailygrind.dailyGrind` |
| `GOOGLE_PLAY_PACKAGE_NAME` | the **Android** application id, currently `com.dailygrind.daily_grind` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | the service account key file, as JSON text |

A platform is enabled when its own variables and `STORE_PRO_PRODUCT_IDS` are all set. Mark the keys sensitive.

### 4. App build

```
flutter build appbundle / ipa \
  --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=... --dart-define=API_BASE_URL=... \
  --dart-define=STORE_PRO_PRODUCT_ID=dailygrind_pro_monthly \
  --dart-define=STORE_PRO_PERIOD=month \
  --dart-define=TERMS_URL=https://... --dart-define=PRIVACY_URL=https://...
```

`STORE_PRO_PERIOD` ("month" or "year") is only wording in the offer and must match the product. Without
`STORE_PRO_PRODUCT_ID` the app has no purchase UI at all.

## Things to decide or do before review

- **Terms of use and a privacy policy** must exist and be linked next to the offer (both stores reject apps without them).
  They are written (`public/terms.html`, `public/privacy.html`, served at `/terms` and `/privacy`) with three placeholders for
  the operator's name, address and contact email: fill them in and run `npm run check:legal`. Apple also needs the privacy policy
  URL in App Store Connect. The store forms (Apple App Privacy, Google Data safety) and review risks, including Sign in with Apple,
  are in [`STORE_LISTING.md`](STORE_LISTING.md).
- **Account deletion** (Apple requires it in-app; it exists) does not cancel a store subscription. The app says so before
  deleting, and tells people to cancel in their store settings first.
- **Existing Stripe customers** are not affected. Someone who subscribes on the web and later in a store is refused
  while the first is active.
- Apple takes 15-30%, Google 15%: price accordingly. Free-tier copy in the app no longer points to the web for buying
  when the in-app offer is available (Apple's anti-steering rules).

## Testing

- Unit tests cover the store lookups (with generated keys and fake responses), the linking rules, both endpoints, and the
  app's purchase flow with a fake store: `npx vitest run api` and `cd mobile && flutter test test/billing test/ui/paywall_test.dart`.
- With real accounts: use a Google *license tester* and an Apple *sandbox tester*. Apple's sandbox purchases arrive at the
  production API first and are retried against the sandbox automatically (404 fallback). Verify, in this order:
  buy, restore on a second device, let a sandbox renewal happen (accelerated: monthly = 5 minutes), cancel, refund.
- Nothing here has run against a real store yet: the request shapes follow Apple's *App Store Server API* (Get All
  Subscription Statuses) and Google's *subscriptionsv2.get* documentation, so the first sandbox purchase is the real test.
