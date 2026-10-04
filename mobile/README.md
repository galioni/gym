# Daily Grind — mobile app (Flutter)

The phone client for Daily Grind: a local-first workout tracker that keeps the same data as the web app. It talks to the same
backend (Supabase Postgres with row level security and auth, and the Vercel `/api/*` functions) and **merges, hashes and sanitises
exactly as the web app does**, so a person can use both on one account.

Flutter 3.44 / Dart 3.12. Android builds on Windows; an iOS build needs a Mac (see below).

## What is in it

| | |
|---|---|
| Day tracker | warm-up and main sections, timers, notes, weight, daily check, session picker, week plan |
| Settings | account, appearance (light / dark / system), AI plan and model, session templates, plans, subscription, sync, data |
| History | streak and totals, body-weight chart, every logged day by week, swipe to remove |
| Onboarding | the plan wizard (AI-generated templates), also reachable as "Regenerate plan" |
| Sync | three-way merge against a base of content hashes, tombstones for deletes, Free-plan allowance and 7-day cloud window, automatic sync with a realtime hint |
| Billing | buying Pro in the App Store / Google Play (off until configured: `docs/MOBILE_STORE_BILLING.md`) |
| Sign-in | email and password, Google, and Sign in with Apple on iPhone (needs the setup in `docs/SIGN_IN_WITH_APPLE.md`; the Apple token is revoked when the account is deleted) |

## Layout

```
lib/
  domain/    models, sanitisers, rules, labels: pure Dart, no Flutter (ports of the web's utils and application/*)
  sync/      content hash, merge, SyncService, allowance, conflicts: the web's application/sync, ported
  data/      SQLite storage (one row per day), Postgres/PostgREST repositories, ownership guard
  api/       the Vercel API client (subscription, plan generation, store purchase)
  auth/      Supabase auth behind an interface
  billing/   StoreBilling (in_app_purchase) and the ProPurchases flow
  state/     ChangeNotifier controllers: tracker, timers, workspace, auto sync, theme
  app/       AppServices: the one place everything is wired together (the app and the tests share it)
  ui/        screens
test/        mirrors lib/, plus contract/ (replays the web fixtures), support/ (harnesses) and live/ (needs a local stack)
```

## The contract with the web app

Hashing, merging, sanitising, wording and ordering must agree with the web, or two devices would disagree about what changed.
So the web generates golden fixtures (`../contract/*.fixtures.json`) and `test/contract/*` replays them. The sync engine is also
proven scenario by scenario: `../contract/syncScenarios.contract.test.ts` runs 27 multi-device scenarios through the real web
`SyncService` and `test/sync/` runs the same through the Dart one. **Any change to sync, hashing or sanitising has to land in the
web, the Dart code and the fixtures together.** See `../contract/README.md`.

## Run

```bash
flutter pub get
flutter run \
  --dart-define=SUPABASE_URL=https://PROJECT.supabase.co \
  --dart-define=SUPABASE_ANON_KEY=ANON_OR_PUBLISHABLE_KEY \
  --dart-define=API_BASE_URL=https://YOUR-VERCEL-DEPLOYMENT
```

Optional `--dart-define`s: `AUTH_REDIRECT_URL` (default `com.dailygrind.app://login-callback`, which must be in the Supabase
redirect allow-list), and for in-app purchase `STORE_PRO_PRODUCT_ID`, `STORE_PRO_PERIOD` (`month` | `year`), `TERMS_URL`,
`PRIVACY_URL`. Without `STORE_PRO_PRODUCT_ID` the app has no purchase screens. A build missing the three required values shows a
configuration message instead of crashing (`lib/core/app_config.dart`).

Against the local Docker stack (from the repo root `npm run gym:up`): from the Android emulator use `http://10.0.2.2:<port>` for
the host's localhost (the stack's gateway for Supabase, 3010 for the API).

## Test

```bash
flutter analyze
flutter test                      # about 530 tests, no network, no Docker
```

- UI tests use `uiTest` and `pumpDashboard` from `test/support/app_harness.dart` (real SQLite in memory, a fake cloud, fake store).
  Flutter's test font makes text very wide, so a layout overflow in a test can be an artefact; check before "fixing" it.
- Screenshots (real fonts and icons) to look at the screens: `SCREENSHOT_DIR=build/screens flutter test test/tools/screenshots_test.dart`.
- `test/live/live_supabase_test.dart` drives the real adapters against a **local** Supabase stack and is skipped unless configured.
  It refuses any host other than localhost. It needs `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_ANON_KEY` and `LIVE_SUPABASE_SERVICE_KEY`
  (from the stack's `.env.local`: `GYM_ANON_KEY`, `GYM_SERVICE_ROLE_KEY`). If another Supabase stack already holds ports 54321/54322,
  start the gym stack on others first: `GYM_GATEWAY_PORT=64321 GYM_DB_PORT=64322 npm run gym:up`.

## Build

```bash
flutter build apk --debug           # also: appbundle for the Play Store
flutter build ios --no-codesign     # macOS only; CI has a manual job for it: .github/workflows/mobile.yml
```

Ids: Android `com.dailygrind.daily_grind`, iOS `com.dailygrind.dailyGrind`. On Windows with the project and the pub cache on
different drives, `android/gradle.properties` turns off Kotlin incremental compilation (`kotlin.incremental=false`).

## Differences from the web app, on purpose

- Ids missing from older template rows are assigned when templates are stored (the web gives them fresh random ids on every read).
- Impossible dates such as `2026-02-31` are rejected (the web lets some through).
- Billing: purchases go through the stores, not Stripe; a subscription bought on the web is managed on the web.

## Not done yet

iOS has never been built or run (needs a Mac), so Sign in with Apple has not run against Apple either; store billing has not run against real stores; the app has not been tried on a
physical device. The full list is in `../docs/NEXT_PHASES_README.md`.
