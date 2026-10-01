# Daily Grind

Local-first workout tracker with AI-generated training plans, cloud sync, and Stripe subscriptions. Built with React + TypeScript (Vite), Vercel serverless API, Supabase auth, Upstash KV.

## Prerequisites

- **Node.js 20+** (CI runs on Node 20; `node -v` to verify)
- **Vercel account** — for running the API locally and deploying
- **Supabase project** — auth (Google OAuth + email/password must be enabled in the Supabase dashboard)
- **Upstash Redis database** — for cloud sync and subscription state
- **Stripe account** — for subscription billing
- **OpenAI API key** — for AI plan generation

## Run

```bash
npm install
```

**Terminal 1 — API (Vercel serverless, port 3000):**
```bash
npx vercel dev --listen 3010
```

**Terminal 2 — Frontend (Vite, port 5180):**
```bash
npm run dev
```

Open the app at `http://localhost:5180`.

> **First time?** Copy `.env.example` to `.env.local` and fill in all required values before starting. See [Environment Variables](#environment-variables) below.

## Scripts

- `npm run dev`: start Vite dev server
- `npm run build`: type-check and build
- `npm run test`: run Vitest suites
- `npm run test:watch`: run Vitest in watch mode
- `npm run qa:check`: run TypeScript type-check only
- `npm run lint`: run ESLint across the codebase

## Architecture

- `application/`: use-case services and pure state transitions
- `interfaces/`: repository contracts (ports)
- `infrastructure/`: localStorage/cloud repository adapters
- `features/`: UI feature modules (state hooks + components)
  - `app-shell/`: Dashboard layout, workout grid, keyboard shortcuts
  - `auth/`: Supabase auth — Google OAuth + email/password (sign-in, sign-up, password reset)
  - `billing/`: Stripe subscription hook (`useSubscription`)
  - `feedback/`: Toast notifications and confirm dialogs
  - `landing/`: Marketing landing page (shown when not signed in) — email/password form + Google OAuth
  - `onboarding/`: AI plan generation wizard (shown on first login)
  - `plans/`: Plans state and editor (group sessions into named plans)
  - `qa/`: Smoke panel (accessible at `/?qa=1` in dev)
  - `session-controls/`: Backup import/export logic
  - `settings/`: Settings page (templates, sync, plan/billing, reminders, appearance, data)
  - `sync/`: Cloud sync state and UI
  - `templates/`: Template editor
  - `theme/`, `weight-reminder/`, `workout/`: supporting features
- `components/`: shared UI components
- `api/`: Vercel serverless handlers

Application logic depends on repository interfaces; storage details stay in infrastructure adapters.

## Features

- **AI onboarding** — wizard on first login generates a personalised training plan via OpenAI; questions cover goal, experience, days/week, equipment, session duration, and optional body-focus areas (multi-select: chest, back, shoulders, arms, core, legs, glutes, full body, cardio)
- **Regenerate plan** — Settings → AI Plan → Regenerate reruns the wizard at any time
- **Custom session types** — add, rename, and delete session types from the template editor
- **Plans** — group sessions into named plans; activate a plan to filter the header session dropdown; sessions are shared across plans
- **Timers** — per-section stopwatch with auto-scroll; running state persists when navigating to Settings and back
- **Friday weight check** — configurable banner shown on Fridays between midnight and a target time
- **Duplicate notes/weight** — one-tap copy of the previous day's notes and body weight
- **Cloud sync** — automatic; syncs workout data, templates, plans and preferences across devices through Postgres (free today; planned limits are in `docs/NEXT_PHASES_README.md`)
- **Conflict resolution** — manual keep-local / keep-cloud picker when sync detects diverged data
- **Restore points** — pre-sync snapshots with rollback support
- **Backup** — export and import full JSON backup (workout data + templates)
- **Landing page** — marketing page shown to unauthenticated visitors; supports Google OAuth and email/password sign-in, sign-up (with email confirmation flow), and password reset (with in-app set-password screen)
- **Subscription** — Stripe-backed Pro plan; free users get local-only access
- **Account deletion** — permanently deletes the auth account (and with it all Postgres data), any legacy KV sync data, and the Stripe customer record

## User Flow

1. **Not signed in** → Landing page (`features/landing/`) with email/password form + Google OAuth
2. **First login** → Onboarding wizard: goal, experience, days/week, equipment, duration, optional body focus → OpenAI generates a personalised training plan → saved as templates
3. **Dashboard** → Daily workout tracking (warm-up + main session, timers, notes, progress)
4. **Settings** → Templates, plans, sync, plan/billing, reminders, appearance, data export/import

## Storage

localStorage keys:
- Workout data: `daily-workout-tracker:v2`
- Templates: `daily-workout-tracker:templates:v1`
- Plans: `daily-workout-tracker:plans:v1`
- Active plan: `daily-workout-tracker:active-plan:v1`
- Sync settings: `daily-workout-tracker:sync-settings:v1`
- Sync restore points: `daily-workout-tracker:sync-restore-points:v1`
- Weight reminder: `daily-workout-tracker:weight-reminder`
- Onboarding complete: `daily-workout-tracker:onboarded:v1`

Upstash KV keys:
- Legacy cloud sync (no longer written, removed with the account): `sync:{userId}:workout-data`, `sync:{userId}:templates`, `sync:{userId}:plans`

## API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/generate-plan` | POST | Required | Calls OpenAI `gpt-4o-mini` to generate training templates. Rate-limited: 5/min per IP (in memory), 10/hr per user (counted in Postgres, `rate_events`). |
| `/api/subscription` | GET | Required | Returns the current plan and subscription status (table `subscriptions` in Postgres). |
| `/api/create-checkout-session` | POST | Required | Creates Stripe Checkout session, returns redirect URL. |
| `/api/billing-portal` | POST | Required | Creates Stripe Customer Portal session, returns redirect URL. |
| `/api/stripe-webhook` | POST | Stripe signature | Handles `checkout.session.completed`, `customer.subscription.updated/deleted`. Updates the `subscriptions` table; processed event ids are kept in `stripe_events` so retries are not applied twice. |
| `/api/delete-account` | DELETE | Required | Deletes the Stripe customer, any legacy KV sync data and the Supabase auth account (which removes all of the user's Postgres data). |

## Subscription Model

| | Free (£0) | Pro (£1.99 / month) |
|---|---|---|
| Workout tracking, templates, plans, backup export / import | yes, on the device | yes |
| Templates / plans in the cloud | 5 / 20 | 200 / 100 |
| Workout days in the cloud | 1,000 | 5,000 |
| Cloud sync | one sync every 30 days, started by you; the first sync on a new device runs on its own but only downloads | automatic, no limit |
| History kept in the cloud | the last 7 days (older days stay on the device) | everything, up to the day limit |
| AI plan generation | 1 per rolling day, Gemini | 10 per rolling hour, choice of Gemini / Claude / ChatGPT |

- The facts shown to people live in `application/plans/planCatalog.ts` (landing page, Settings, upgrade prompts); the enforced numbers live in `api/_lib/planLimits.ts` (AI) and the `*_plan_row_limits` and `*_sync_allowance` migrations. A test keeps the TypeScript ones equal.
- **If Pro ends, nothing is deleted.** Everything stays on the device and in the cloud and can still be edited; the account just cannot add beyond the Free limits until it upgrades or deletes something.
- Upgrade prompts appear where a limit is met: the plan-generation message, the storage-limit notice, the used monthly sync, and the locked AI providers.
- Subscription state is stored in Postgres (table `subscriptions`, one row per user; the Stripe customer id on that row is how the webhook finds the user). Only the server writes it, with the service-role key; a user can read their own row. What is charged is the Stripe Price behind `STRIPE_PRO_PRICE_ID`.

## Authentication

- Client auth: Supabase — Google OAuth + email/password (`signInWithPassword`, `signUp`, `resetPasswordForEmail`)
- API auth: local JWT verification via `jose` (HS256, `audience: "authenticated"`, issuer from `SUPABASE_URL`)
- Stripe webhook: HMAC-SHA256 signature verification (no Supabase JWT)

## Environment Variables

### Client runtime (`.env.local`, exposed as `VITE_*`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_REDIRECT_URL`

### API runtime (Vercel project env for `/api/*` handlers)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET` — found in Supabase → Project Settings → API → JWT Secret; used to verify tokens in every API handler
- `SUPABASE_SERVICE_ROLE_KEY` — required for account deletion (`/api/delete-account`)
- `KV_REST_API_URL` (or `STORAGE_KV_REST_API_URL`)
- `KV_REST_API_TOKEN` (or `STORAGE_KV_REST_API_TOKEN`)
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard after registering the webhook endpoint
- `STRIPE_PRO_PRICE_ID` — price ID of the Pro subscription product in Stripe
- Optional: `CORS_ALLOWED_ORIGINS` — comma-separated list of additional allowed origins
- Auto-set by Vercel (no action needed): `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` — used for CORS origin allowlist

### Never store in local env files

- `SUPABASE_SERVICE_ROLE_KEY` — server-only; if leaked it bypasses all auth
- `SUPABASE_SECRET_KEY`
- `VERCEL_OIDC_TOKEN`
- `POSTGRES_*`

Rotation policy: rotate privileged secrets immediately if exposed; remove from scopes that don't need them.

## Local stack (Docker, works offline)

Everything the app talks to runs in one Docker Compose project, `gym-app`. Nothing starts on its own
(`restart: "no"`); you start and stop it explicitly. Requires Docker Desktop. The first `up` pulls any missing images
and runs `npm ci` inside the container, so it needs a network once.

```bash
npm run gym:init              # once: writes .env.local with generated, local-only secrets
                              #       (your previous .env.local is kept as .env.local.remote)
npm run gym:up                # start the core stack
npm run gym:up -- mail stripe studio   # ...plus any optional profiles
npm run gym:down              # stop (data kept)    |  npm run gym:reset   # stop and delete all data
npm run gym:ps | gym:logs [service] | gym:restart <service>
npm run gym:migrate           # apply new files from supabase/migrations (also runs automatically on gym:up)
npm run gym:psql              # psql into the local database (extra args go to psql, e.g. -c "select count(*) from workout_days")
npm run gym:seed -- you@example.com   # 4 weeks of demo workout days for an account you signed up with locally
npm run gym:test-db           # RLS/constraint tests + end-to-end API smoke test against the running stack
npm run gym:test-sync         # two real browsers, one account: automatic sync, new-browser pull, clash handling, deletes
                              #   GYM_BROWSER=webkit|firefox  GYM_DEVICE="iPhone 13"  GYM_SCENARIOS=sync,delete
                              #   GYM_PROJECT=<name> runs a separate copy of the stack (own containers and volumes)
```

| Service | Replaces | Image |
|---|---|---|
| `db` | Supabase Postgres | `public.ecr.aws/supabase/postgres` |
| `auth` | Supabase Auth (GoTrue) | `public.ecr.aws/supabase/gotrue` |
| `migrate` (one-shot) | applies `supabase/migrations` | same image as `db` |
| `rest` | Supabase REST (PostgREST) | `public.ecr.aws/supabase/postgrest` |
| `gateway` | Supabase gateway (`/auth/v1`, `/rest/v1`) | `caddy:2-alpine` |
| `kv` + `kv-rest` | Upstash KV | `redis:7` + `hiett/serverless-redis-http` |
| `deps`, `web`, `api` | Vite + Vercel `/api` functions | `node:24-bookworm-slim` (`scripts/local/dev-api.ts` replaces `vercel dev`) |
| `mail` (profile) | SMTP provider | `axllent/mailpit` |
| `stripe` (profile) | api.stripe.com | `stripe/stripe-mock` |
| `studio`, `meta` (profile) | Supabase Studio | `public.ecr.aws/supabase/studio`, `postgres-meta` |

**Schema types.** `infrastructure/supabase/database.types.ts` is the hosted schema as TypeScript. It is not used to talk to the database; `databaseTypes.testSupport.ts` compares it with the hand-written row types in `postgresRows.ts` during `tsc`, so a migration that adds, renames or retypes a column fails the type-check until both are updated. Regenerate it after a migration (`supabase gen types typescript --project-id <ref>`, or the Supabase MCP `generate_typescript_types`), keeping only the tables and functions the app uses. `supabase/config.toml` lets the Supabase CLI `link` and `db push` the same migrations.

Database schema lives in `supabase/migrations` (Supabase CLI layout, so the same files can later be pushed to the hosted project). Every table has row level security; `gym:test-db` proves users cannot read or change each other's rows and that billing state is read-only for clients.

### How sync works

Workouts, templates, plans and a few account preferences (the active plan and plan details) are stored in the browser (instant, works offline) and in Postgres, which is the source of truth for every signed-in user. Sync runs automatically: after sign-in, a few seconds after edits, when the connection returns, when the tab regains focus and every 5 minutes. It is a three-way merge against the last state both sides agreed on, **item by item** (a day, a template, a plan), so an ordinary edit is never reported as a conflict and edits to different templates on two devices simply combine; only the very same item changed on both is a conflict you are asked about. Deleting an item on one device deletes it on the others unless it was edited elsewhere since (an edit beats a delete). The header shows the live state: Synced, Syncing, Offline, or Needs attention (tap it for details). Deletions propagate as soft deletes. **Free plan:** an account without Pro syncs once every 30 days, in both directions, from Settings → Sync (the app asks before using the month). The first sync on a new device runs on its own but only downloads, so signing in on a new phone restores your data without spending the month; the database refuses uploads outside the monthly window, and Pro syncs automatically and without limit. The allowance is switched by `app_flags.sync_allowance` in the database. The browser talks to Postgres directly through PostgREST with the user's own token; row level security (see `supabase/migrations`) keeps users apart. Billing state and the AI provider choice live in Postgres; KV is no longer used by the app: rate limits are counted in Postgres too, and the only remaining reference is deleting legacy sync keys when an account is deleted. It is removed in the last step of Phase 15.

**Account limits.** The limits depend on the plan and are enforced in the database (`supabase/migrations/*_row_limits.sql`, made plan-aware by `*_plan_row_limits.sql`) because the browser writes to it directly: **Pro** 5,000 days, 200 session templates and 100 plans; **Free** 1,000 days, 5 templates (the 4 built-in starters plus one of your own) and 20 plans. Pro means an active or trialing Pro subscription. Editing existing data always works, deleting frees room, restoring a deleted day counts like a new one, and the check is safe under concurrent requests. Dropping to Free never deletes anything: it only blocks adding beyond the Free limits. When a limit is hit, Postgres rejects only the new items that do not fit, with code `PT422` (HTTP 422). The app uploads in an order that cannot deadlock (edits to items already in the cloud, then deletions, then new items one by one up to the limit), so edits and deletions always sync, the new items that fit are stored, and changes from your other devices still arrive; the app shows a one-time "Cloud storage limit reached" notice and the reason in Settings → Sync, and nothing is lost locally. To change a limit, replace `row_limit(table, is_pro)` in a new migration.

### Continuous integration

`.github/workflows/ci.yml` has two jobs. `ci` lints (zero warnings allowed), type-checks, runs the unit tests, builds, and runs the mocked Playwright specs. `stack` starts this Compose stack from an **empty database** (so every migration is applied from scratch, then re-run to prove idempotence), then runs `gym:test-db` and `gym:test-sync` on Chromium, WebKit and an iPhone profile. Text colours are guarded by `design/tokens.contrast.test.ts` (WCAG AA for both themes).

Ports (localhost only): app 5180, API 3010, gateway 54321, Postgres 54322, Mailpit 8026, Studio 54323.

Notes:
- Sign-ups auto-confirm by default. To test confirmation emails set `GYM_AUTOCONFIRM=false` in `.env.local`, recreate `auth`, and start the `mail` profile.
- Pro is a row in `public.subscriptions`. Grant it to a local user: `docker compose --env-file .env.local -f docker/compose.yaml -p gym-app exec db psql -U supabase_admin -d postgres -c "insert into public.subscriptions (user_id, plan, status) values ('<userId>', 'pro', 'active') on conflict (user_id) do update set plan = 'pro', status = 'active'"`
- Not available offline: Google sign-in, AI plan generation (needs a provider key).
- `gym:init` refuses to overwrite a generated `.env.local` because an existing Postgres volume keeps its original password; `gym:reset` first, then `gym:init -- --force`.

## Deploy

This project deploys to Vercel. The frontend is built as a static site; the `api/` folder is deployed as serverless functions.

### 1. Link and deploy

```bash
npx vercel login        # if not already logged in
npx vercel link         # connect local repo to a Vercel project
npx vercel --prod       # deploy to production
```

Or connect the GitHub repo in the Vercel dashboard — every push to `main` will auto-deploy.

### 2. Set environment variables

Set all API runtime variables in the Vercel dashboard or via CLI:

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
vercel env add SUPABASE_JWT_SECRET production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add KV_REST_API_URL production
vercel env add KV_REST_API_TOKEN production
vercel env add OPENAI_API_KEY production
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
vercel env add STRIPE_PRO_PRICE_ID production
```

> `SUPABASE_JWT_SECRET` is found in Supabase → Project Settings → API → JWT Secret.

### 3. Register the Stripe webhook

After deploying, go to the Stripe Dashboard and register:

- **Endpoint URL**: `https://your-domain/api/stripe-webhook`
- **Events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

Copy the signing secret and set it as `STRIPE_WEBHOOK_SECRET` in Vercel.

### 4. Enable Supabase auth providers

In the Supabase dashboard → Authentication → Providers:

- **Email** — enable email/password sign-in and set the redirect URL to your production domain
- **Google** — enable OAuth and add your Google OAuth client ID and secret

## CI / CD

GitHub Actions runs on every push and pull request to `main`:

1. `npm audit --production --audit-level=high` — dependency vulnerability check
2. `tsc --noEmit` — type-check
3. `vitest run` — test suite
4. `vite build` — production build (with stub `VITE_*` env vars)

Config: `.github/workflows/ci.yml`

Dependabot is configured (`.github/dependabot.yml`) to open weekly PRs for npm and GitHub Actions dependency updates (minor + patch, batched).

Pre-commit hooks (Husky + lint-staged) run ESLint on staged `.ts` / `.tsx` files before every commit.

`.npmrc` sets `legacy-peer-deps=true` to resolve a peer dependency conflict between `eslint@10` and `eslint-plugin-react-hooks@7` — required for Vercel installs and consistent with the `--legacy-peer-deps` flag used in CI.

## Backup Format

Export/import supports:
- Full backup envelope (workout data + templates + sync metadata)
- Legacy workout-only JSON (backward compatibility)

## QA

- Run tests: `npm run test`
- Smoke panel (dev): `/?qa=1`

## Observability

API handlers emit structured request lifecycle logs for `/api/generate-plan`, `/api/subscription`, `/api/create-checkout-session`, `/api/billing-portal`, `/api/delete-account` with:

- `requestId`
- `endpoint`
- `method`
- `status`
- `latencyMs`
- `userIdHash` (hashed and truncated)

Alert thresholds and incident steps:

- `docs/observability/alerting.md`
- `docs/observability/incident-runbook.md`

---

## Pending — Action Required

Everything below requires manual steps that can't be done in code.

### 1. Create `og-image.png` for social sharing

`index.html` references `/og-image.png` for Open Graph and Twitter Card previews. The source file `public/og-image.svg` exists, but **Twitter/Facebook crawlers do not reliably support SVG** — you need a 1200×630 PNG at `public/og-image.png`.

**Option A — Online (no tools needed, easiest):**

1. Go to [squoosh.app](https://squoosh.app) or [cloudconvert.com/svg-to-png](https://cloudconvert.com/svg-to-png)
2. Upload `public/og-image.svg`
3. Set output size to 1200×630
4. Download and save as `public/og-image.png`

**Option B — ImageMagick (CLI):**

```bash
# Install: winget install ImageMagick.ImageMagick
magick -background none public/og-image.svg -resize 1200x630 public/og-image.png
```

**Option C — Inkscape (CLI):**

```bash
# Install: winget install Inkscape.Inkscape
inkscape public/og-image.svg --export-type=png --export-filename=public/og-image.png -w 1200 -h 630
```

After generating, verify the file exists at `public/og-image.png` and commit it.

### 2. PWA icons (PNG, for Android / Chrome install prompt)

The current icon (`public/icon.svg`) works on modern browsers, but **Android and Chrome install prompts require PNG icons**. `vite.config.ts` already has the updated `icons` array — you just need to generate the two PNG files.

**Step 1 — Generate the PNGs** (same tools as above):

```bash
# ImageMagick
magick -background none public/icon.svg -resize 192x192 public/icon-192.png
magick -background none public/icon.svg -resize 512x512 public/icon-512.png

# Inkscape
inkscape public/icon.svg --export-type=png --export-filename=public/icon-192.png -w 192 -h 192
inkscape public/icon.svg --export-type=png --export-filename=public/icon-512.png -w 512 -h 512
```

Or use [squoosh.app](https://squoosh.app) / [cloudconvert.com](https://cloudconvert.com/svg-to-png) — upload `public/icon.svg`, export at 192×192, save as `icon-192.png`, repeat at 512×512.

**Step 2 — Verify** the files exist:

```
public/icon-192.png
public/icon-512.png
```

**Step 3 — Commit** both files and deploy. The manifest will automatically include them (`vite.config.ts` is already updated).

---

### iOS / App Store (optional, future)

If you want the app on the App Store, use Capacitor:

- Requires Apple Developer account ($99/yr) and a Mac with Xcode
- `npm install @capacitor/core @capacitor/cli @capacitor/ios`
- `npx cap init` → `npx cap add ios`
- `npm run build` → `npx cap sync` → open in Xcode → archive → submit
- Use **RevenueCat** to handle Apple in-app purchases and sync entitlements to the backend
- App Store assets needed: name, subtitle, description, screenshots (6.5" and 5.5"), privacy policy URL, terms of service URL, support URL

---

## Backlog

No open items.

---

### Marketing (optional)

Organic channels (zero budget):
- **Reddit**: r/homegym, r/weightroom, r/fitness — post as a builder, not an advertiser
- **TikTok / Instagram Reels**: film yourself using the app during a real workout; "how I track my training" style
- **Product Hunt**: launch Tuesday–Thursday; needs upvotes from your network on day one
- **X (Twitter)**: build in public — share progress, user feedback, feature updates
