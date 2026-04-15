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
npx vercel dev --listen 3000
```

**Terminal 2 — Frontend (Vite, port 5173):**
```bash
npm run dev
```

Open the app at `http://localhost:5173`.

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
- **Cloud sync** — Pro feature; syncs workout data, templates, and plans across devices via Upstash KV
- **Conflict resolution** — manual keep-local / keep-cloud picker when sync detects diverged data
- **Restore points** — pre-sync snapshots with rollback support
- **Backup** — export and import full JSON backup (workout data + templates)
- **Landing page** — marketing page shown to unauthenticated visitors; supports Google OAuth and email/password sign-in, sign-up (with email confirmation flow), and password reset (with in-app set-password screen)
- **Subscription** — Stripe-backed Pro plan; free users get local-only access
- **Account deletion** — permanently deletes auth account, all KV data, and Stripe customer key

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
- Cloud sync: `sync:{userId}:workout-data`, `sync:{userId}:templates`, `sync:{userId}:plans`
- Subscription: `subscription:{userId}`
- Stripe customer mapping: `stripe_customer:{stripeCustomerId}` → `userId`
- Rate limiting: `ratelimit:{routeKey}:{userId}:{windowSlot}`

## API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/workout-data` | GET, PUT | Required | Cloud sync for workout data. Returns 402 for free users. |
| `/api/templates` | GET, PUT | Required | Cloud sync for templates. Returns 402 for free users. |
| `/api/plans` | GET, PUT | Required | Cloud sync for plans. Returns 402 for free users. |
| `/api/generate-plan` | POST | Required | Calls OpenAI `gpt-4o-mini` to generate training templates. Rate-limited: 5/min per IP, 10/hr per user. |
| `/api/subscription` | GET | Required | Returns current plan and subscription status from KV. |
| `/api/create-checkout-session` | POST | Required | Creates Stripe Checkout session, returns redirect URL. |
| `/api/billing-portal` | POST | Required | Creates Stripe Customer Portal session, returns redirect URL. |
| `/api/stripe-webhook` | POST | Stripe signature | Handles `checkout.session.completed`, `customer.subscription.updated/deleted`. Updates KV. |
| `/api/delete-account` | DELETE | Required | Deletes all KV data, Stripe customer key, and Supabase auth account. |

## Subscription Model

- **Free**: local workout tracking, templates, AI plan generation
- **Pro**: cloud sync across devices (gated at API level — 402 for free users)

Subscription state is stored in Upstash KV (not Supabase). The Stripe webhook writes to KV on payment events. Sync routes read from KV on every request.

## Authentication

- Client auth: Supabase — Google OAuth + email/password (`signInWithPassword`, `signUp`, `resetPasswordForEmail`)
- API auth: local JWT verification via `jose` (HS256, `audience: "authenticated"`, issuer from `SUPABASE_URL`)
- Stripe webhook: HMAC-SHA256 signature verification (no Supabase JWT)

## Environment Variables

### Client runtime (`.env.local`, exposed as `VITE_*`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_REDIRECT_URL`
- `VITE_SYNC_API_BASE_URL` — set to `http://localhost:3000` for local dev

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

## Local Cloud Sync Dev

1. Set `VITE_SYNC_API_BASE_URL=http://localhost:3000` in `.env.local`
2. Terminal 1: `npx vercel dev --listen 3000`
3. Terminal 2: `npm run dev`
4. Open `http://localhost:5173`

Notes:
- `npm run dev` only starts Vite — it does not run `/api/*` handlers
- `vercel dev` requires a valid Vercel login; run `npx vercel login` if it fails
- Local API requires: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, KV vars, `OPENAI_API_KEY`, Stripe vars

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

1. `tsc --noEmit` — type-check
2. `vitest run` — test suite
3. `vite build` — production build (with stub `VITE_*` env vars)

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

API handlers emit structured request lifecycle logs for `/api/workout-data`, `/api/templates`, `/api/generate-plan`, `/api/subscription`, `/api/create-checkout-session`, `/api/billing-portal`, `/api/plans`, `/api/delete-account` with:

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

Findings from a full security, performance, code quality, and product audit. Grouped by area and sorted by priority within each section.

### Security

| Priority | Issue | Location | Status |
|----------|-------|----------|--------|
| ~~High~~ | ~~**Rate limiting fails open** — when Upstash is unavailable `checkRateLimit()` returns `allowed: true`, bypassing limits during outages~~ | ~~`api/_lib/rateLimiter.ts`~~ | ✅ Done — fail-open paths now log errors |
| ~~High~~ | ~~**Unvalidated `client_reference_id` from Stripe webhook** — userId accepted without verifying the user exists~~ | ~~`api/stripe-webhook.ts`~~ | ✅ Done — logs warning and returns 200 on missing fields |
| ~~High~~ | ~~**Return URLs not whitelisted** — `isValidUrl()` accepts any HTTPS URL on checkout session creation~~ | ~~`api/create-checkout-session.ts`~~ | ✅ Done — `isAllowedReturnUrl()` validates against CORS allowlist |
| Medium | **Account deletion leaks internal error messages** — full Supabase error bubbled to client | `api/delete-account.ts` | Open |
| Medium | **Stripe customer ID not verified to belong to authenticated user** on billing portal request | `api/billing-portal.ts` | Open |
| ~~Medium~~ | ~~**Error stack logged to console in production**~~ | ~~`components/ErrorBoundary.tsx`~~ | ✅ Done — guarded behind `import.meta.env.DEV` |

### Performance

| Priority | Issue | Location | Status |
|----------|-------|----------|--------|
| ~~High~~ | ~~**No timeout on OpenAI API call** — network stall hangs the serverless function indefinitely~~ | ~~`api/generate-plan.ts`~~ | ✅ Done — 30s `AbortController` timeout added |
| ~~Medium~~ | ~~**Subscription status fetched with no caching** — hits `/api/subscription` on every relevant render~~ | ~~`features/billing/hooks/useSubscription.ts`~~ | ✅ Done — 5-min module-level cache keyed by user id |
| ~~Low~~ | ~~**Stripe webhook KV writes not batched** — multiple sequential KV calls per event~~ | ~~`api/stripe-webhook.ts`~~ | ✅ Done — consolidated into single pipeline call |

### Code Quality

| Priority | Issue | Location | Status |
|----------|-------|----------|--------|
| ~~High~~ | ~~**Silent `.catch(() => {})` in `useSubscription`** — user stuck on loading spinner if API fails~~ | ~~`features/billing/hooks/useSubscription.ts`~~ | ✅ Done — `fetchError` state exposed; error message shown in Settings |
| ~~Medium~~ | ~~**No input validation on session type labels** — no max length, no control character check~~ | ~~`features/templates/components/TemplateEditor/`~~ | ✅ Done — `maxLength=50` on all session name inputs |
| Medium | **No integration test for Stripe webhook → KV → subscription status flow** | `api/` | Open |
| ~~Medium~~ | ~~**No `npm audit` in CI**~~ | ~~`.github/workflows/ci.yml`~~ | ✅ Done — `npm audit --production --audit-level=high` step added |

### Product / Enhancements

| Priority | Issue | Location | Status |
|----------|-------|----------|--------|
| High | **No loading state or feedback during AI plan generation** — 3–5s wait with no spinner | `features/onboarding/components/OnboardingWizard/` | ✅ Done (spinner + cycling status text already existed) |
| ~~High~~ | ~~**No error differentiation on plan generation** — timeout, 429, and 5xx all look the same to the user~~ | ~~`features/onboarding/components/OnboardingWizard/`~~ | ✅ Done — 429 shows retry time; 5xx shows server error message |
| ~~High~~ | ~~**No grace period when Pro subscription expires** — sync access cut off immediately~~ | ~~`api/plans.ts`, `api/templates.ts`, `api/workout-data.ts`~~ | ✅ Done — 7-day read-only grace period via `hasProReadAccess()` |
| ~~Medium~~ | ~~**Rate limit not surfaced to user** — `Retry-After` not returned; user doesn't know when to retry~~ | ~~`api/generate-plan.ts`~~ | ✅ Done — `toCloudApiError()` now reads `retry-after` header and formats message |
| ~~Medium~~ | ~~**Stripe customer record orphaned on account deletion**~~ | ~~`api/delete-account.ts`~~ | ✅ Done — `deleteStripeCustomer()` called best-effort on account delete |
| Medium | **No duplicate session type name validation** — two types with the same name can coexist | `features/templates/components/TemplateEditor/` | Open |
| ~~Medium~~ | ~~**Timer has no accessibility labels** — no `aria-label` for running/paused state~~ | ~~`components/Timer.tsx`~~ | ✅ Done — `role="timer"` + dynamic `aria-label` added |
| ~~Low~~ | ~~**Onboarding skip leaves empty dashboard with no warning**~~ | ~~`features/onboarding/components/OnboardingWizard/`~~ | ✅ Done — skip button now shows warning about empty templates |

---

### Marketing (optional)

Organic channels (zero budget):
- **Reddit**: r/homegym, r/weightroom, r/fitness — post as a builder, not an advertiser
- **TikTok / Instagram Reels**: film yourself using the app during a real workout; "how I track my training" style
- **Product Hunt**: launch Tuesday–Thursday; needs upvotes from your network on day one
- **X (Twitter)**: build in public — share progress, user feedback, feature updates
