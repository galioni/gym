# Pending

State as of **2026-10-04**. Nothing from the mobile / billing / Sign in with Apple work is committed: it is all in the working
tree on `main`. This file lists what is left; the longer history and reasoning are in `docs/NEXT_PHASES_README.md` (Phase 18). When
an item is done, delete it here rather than ticking it, so the file cannot go stale.

## 1. Needs you (nothing here can be done from code)

### Commit and merge
- [ ] **Decide how to commit and open the PR(s).** Changed areas: web (`api/`, `features/`, `application/`, `components/`, `src/sw.ts`,
  `public/`, `vercel.json`, `package.json`), `contract/`, `mobile/`, `supabase/` (migrations, tests), `docker/` and `scripts/local/`,
  `.github/workflows/mobile.yml`, `docs/`, the READMEs.
- [ ] **Two migrations apply to production when the PR merges** (the Supabase GitHub integration does it): `20261003120000_store_billing`
  and `20261004100000_apple_signin_tokens`. Both are additive and old code keeps working.
- [ ] CI must be green first. Not run locally: the Playwright E2E suite (it covers the Timer change, the legal pages and the landing
  page / Settings links).

### Legal pages (`public/terms.html`, `public/privacy.html`)
- [ ] Fill in `[OPERATOR NAME]`, `[OPERATOR ADDRESS]`, `[CONTACT EMAIL]` in both pages. `npm run check:legal` fails until done.
- [ ] Have both pages read by someone qualified. They assume: England and Wales law, UK ICO, minimum age 16, a £50 liability floor,
  14-day cancellation wording, and that backups follow Supabase's normal schedule (confirm that one).
- [ ] After deploying, open `/terms` and `/privacy` in a private window, signed out.

### Store billing go-live (`docs/MOBILE_STORE_BILLING.md`)
- [ ] Apple and Google developer accounts; one subscription product with the **same id** in both stores.
- [ ] Vercel variables: `STORE_PRO_PRODUCT_IDS`, `STORE_WEBHOOK_SECRET`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`,
  `APPLE_IAP_PRIVATE_KEY`, `APPLE_BUNDLE_ID`, `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- [ ] Notification URLs: App Store Server Notifications V2 and a Google Pub/Sub push subscription, both with the secret in the URL.
- [ ] App build flags: `STORE_PRO_PRODUCT_ID`, `STORE_PRO_PERIOD`, `TERMS_URL`, `PRIVACY_URL`.
- [ ] Sandbox tests, in order: buy, restore on a second device, a renewal, cancel, refund. **Nothing has run against a real store**;
  the request shapes follow Apple's and Google's documentation.

### Sign in with Apple (`docs/SIGN_IN_WITH_APPLE.md`)
- [ ] Turn on the **Sign In with Apple** capability for the iOS App ID (`com.dailygrind.dailyGrind`).
- [ ] Create a Sign in with Apple key (not the in-app purchase key); note the Key ID and the Team ID.
- [ ] Supabase dashboard: enable the Apple provider, Client ID = the iOS bundle id. (The connector cannot edit hosted Auth settings.)
- [ ] Vercel variables: `APPLE_SIGNIN_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`, `APPLE_SIGNIN_PRIVATE_KEY`, `APPLE_BUNDLE_ID`.
- [ ] Device test (**none of this has ever run against Apple**), in this order:
  1. Sign in with Apple, hiding the email: a row appears in `apple_auth_tokens`.
  2. Settings → Account → **Set a password**, then sign in on the website with the relay address and that password.
  3. Delete the account: Apple's sheet should appear once more, and afterwards Daily Grind should be gone from Settings → Apple ID
     → Sign in with Apple.
  4. Repeat 3 with the sheet closed (the stored token is the fallback) and, if you can, with an account created before the
     `APPLE_SIGNIN_*` variables were set (the fresh code is the only way to revoke it).

### Store listings (`docs/STORE_LISTING.md`)
- [ ] Enter the privacy and terms URLs, the Apple App Privacy answers, and the Google Data safety answers.
- [ ] Google: the account-deletion URL (`/privacy#delete-data`), the Health apps declaration, target audience.
- [ ] A review login (Free, and a Pro one through a sandbox purchase) and review notes.

### Left over from before this work
- [ ] Hosted two-device Realtime test (edit on one device, the other updates within seconds).
- [ ] Delete the two Upstash KV stores (`upstash-kv-aquamarine-cable`, and the orphan `upstash-kv-copper-fence`) and the leftover
  `KV_*` / `STORAGE_KV_*` / `REDIS_URL` Vercel variables.

## 2. Needs a Mac or a device

- [ ] **First iOS build** (`flutter build ios --no-codesign`; CI has a manual macOS job in `.github/workflows/mobile.yml`). Check in
  particular the hand-edited project file (`Runner.entitlements` and its three build-configuration references).
- [ ] Run the app on a physical device (Android and iPhone). It has not been tried on one.
- [ ] Look at the onboarding wizard, the paywall and the Apple button in screenshots
  (`SCREENSHOT_DIR=build/screens flutter test test/tools/screenshots_test.dart`). They are tested but have not been looked at.
- [ ] iOS and Android ids differ (`com.dailygrind.dailyGrind`, `com.dailygrind.daily_grind`): make sure each store variable uses the
  right one.

## 3. Known gaps in the code

None known at the moment. (Optional, not needed: a "Continue with Apple" button on the website; see
`docs/SIGN_IN_WITH_APPLE.md`.)

## 4. Local environment (this machine)

- [ ] The `gym-app` Docker stack is still **running** (ports 64321 / 64322 / 3010 / 5180). `npm run gym:down` stops it and keeps the
  data. Docker Desktop is also running; it hosts another project's stack (`ccuk-hub-dev`), so do not quit it without checking.
- [ ] On this machine another Supabase stack holds 54321 / 54322, so the gym stack needs `GYM_GATEWAY_PORT=64321 GYM_DB_PORT=64322`
  exported for every `gym:*` command and for the Dart live test.

## 5. Before merging: re-run everything

```bash
npx tsc --noEmit && npx eslint . --max-warnings 0 && npx vitest run     # web: 659 tests
cd mobile && flutter analyze && flutter test                           # 566 tests, 11 skipped
npm run check:legal                                                    # fails until the placeholders are filled in
export GYM_GATEWAY_PORT=64321 GYM_DB_PORT=64322
npm run gym:test-db && npm run gym:test-sync                           # needs the stack up; test-sync takes several minutes
# live Dart test against the local stack: see mobile/README.md (needs the LIVE_SUPABASE_* variables)
```
