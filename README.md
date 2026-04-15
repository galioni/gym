# Daily Grind

Local-first workout tracker with AI-generated training plans, cloud sync, and Stripe subscriptions. Built with React + TypeScript (Vite), Vercel serverless API, Supabase auth, Upstash KV.

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

## Scripts

- `npm run dev`: start Vite dev server
- `npm run build`: type-check and build
- `npm run test`: run Vitest suites
- `npm run qa:check`: run TypeScript type-check only
- `npm run lint`: run ESLint across the codebase

## Architecture

- `application/`: use-case services and pure state transitions
- `interfaces/`: repository contracts (ports)
- `infrastructure/`: localStorage/cloud repository adapters
- `features/`: UI feature modules (state hooks + components)
  - `auth/`: Supabase auth — Google OAuth + email/password (sign-in, sign-up, password reset)
  - `billing/`: Stripe subscription hook (`useSubscription`)
  - `landing/`: Marketing landing page (shown when not signed in) — email/password form + Google OAuth
  - `onboarding/`: AI plan generation wizard (shown on first login)
  - `plans/`: Plans state and editor (group sessions into named plans)
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
- `SUPABASE_JWT_SECRET`
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

## CI / CD

GitHub Actions runs on every push and pull request to `main`:

1. `tsc --noEmit` — type-check
2. `vitest run` — test suite
3. `vite build` — production build (with stub `VITE_*` env vars)

Config: `.github/workflows/ci.yml`

Dependabot is configured (`.github/dependabot.yml`) to open weekly PRs for npm and GitHub Actions dependency updates (minor + patch, batched).

Pre-commit hooks (Husky + lint-staged) run ESLint on staged `.ts` / `.tsx` files before every commit.

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

### 1. Vercel environment variables

Set these in the Vercel dashboard (or via CLI) for the **Production** environment:

```bash
vercel env add OPENAI_API_KEY production
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
vercel env add STRIPE_PRO_PRICE_ID production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

`SUPABASE_SERVICE_ROLE_KEY` is needed by `/api/delete-account`. Get it from Supabase → Project Settings → API → `service_role` key. Never expose it client-side.

Verify the other required vars are already set (they should be if you set up auth/sync previously):

```bash
vercel env ls
# Should include: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET,
#                 KV_REST_API_URL, KV_REST_API_TOKEN
```

### 2. Stripe webhook registration

After deploying, register the webhook in the Stripe Dashboard:

- **Endpoint URL**: `https://your-domain/api/stripe-webhook`
- **Events to listen for**:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Copy the generated **Signing secret** and set it as `STRIPE_WEBHOOK_SECRET` in Vercel.

### 3. Fix hardcoded production URL in `index.html`

`index.html` has two hardcoded references to `gym-galioni.vercel.app` that should match your real production domain:

```html
<meta property="og:url" content="https://gym-galioni.vercel.app" />   <!-- line 25 -->
<meta name="twitter:image" content="/og-image.png" />                   <!-- implicit path -->
```

Update `og:url` to your production URL. While you're there, update `og:image` (see next item).

### 4. Create `og-image.png` for social sharing

`index.html` references `/og-image.png` for Open Graph and Twitter Card previews. The file `public/og-image.svg` exists as a source, but **Twitter/Facebook crawlers do not reliably support SVG** for OG images — you need a PNG.

Convert `public/og-image.svg` to `public/og-image.png` at 1200×630:

```bash
# Option A: browser (simplest)
# Open og-image.svg in Chrome → right-click → Save as image / screenshot

# Option B: Inkscape CLI
inkscape public/og-image.svg --export-type=png --export-filename=public/og-image.png -w 1200 -h 630

# Option C: ImageMagick
magick -background none public/og-image.svg -resize 1200x630 public/og-image.png
```

### 5. PWA icons (PNG, for Android / Chrome install prompt)

`vite-plugin-pwa` is configured and will generate a manifest automatically. The current icon (`public/icon.svg`) works on modern browsers, but **Android and Chrome install prompts require PNG icons**.

Add these files to `public/`:

- `icon-192.png` — 192×192 PNG (required by Chrome install prompt)
- `icon-512.png` — 512×512 PNG (used for splash screen and Play Store listing if submitted)

Then update the `icons` array in `vite.config.ts`:

```ts
icons: [
  { src: 'icon.svg',    sizes: 'any',       type: 'image/svg+xml', purpose: 'any' },
  { src: 'icon-192.png', sizes: '192x192',  type: 'image/png' },
  { src: 'icon-512.png', sizes: '512x512',  type: 'image/png', purpose: 'any maskable' },
],
```

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

### Marketing (optional)

Organic channels (zero budget):
- **Reddit**: r/homegym, r/weightroom, r/fitness — post as a builder, not an advertiser
- **TikTok / Instagram Reels**: film yourself using the app during a real workout; "how I track my training" style
- **Product Hunt**: launch Tuesday–Thursday; needs upvotes from your network on day one
- **X (Twitter)**: build in public — share progress, user feedback, feature updates
