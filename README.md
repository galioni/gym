# Daily Workout Tracker

Local-first workout tracker built with React + TypeScript (Vite), with cloud sync enabled.

## Run

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev`: start dev server
- `npm run build`: type-check and build
- `npm run test`: run Vitest suites
- `npm run qa:check`: run TypeScript checks

## Architecture

- `application/`: use-case services and pure state transitions
- `interfaces/`: repository contracts (ports)
- `infrastructure/`: localStorage/cloud repository adapters
- `features/`: UI feature modules (state hooks + components)
- `components/`: shared UI components

Application logic depends on repository interfaces, while storage details remain in infrastructure adapters.

## Storage

- Workout data: `daily-workout-tracker:v2`
- Templates: `daily-workout-tracker:templates:v1`
- Sync settings: `daily-workout-tracker:sync-settings:v1`
- Sync restore points: `daily-workout-tracker:sync-restore-points:v1`
- Cloud sync keys: `sync:{supabaseUserId}:workout-data`, `sync:{supabaseUserId}:templates`

## Authentication

- Client auth uses Supabase Google OAuth (`Continue with Google` only).
- API sync endpoints require a valid Supabase access token in `Authorization: Bearer <token>`.
- Legacy static sync API key auth is removed.

## Environment Ownership (Least Privilege)

Only configure variables required by each runtime. Do not copy platform/admin secrets into local app env files.

Client runtime (`.env.local`, exposed as `VITE_*`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_REDIRECT_URL`
- `VITE_SYNC_API_BASE_URL`

For local cloud-sync development, point the frontend at the local Vercel API runtime instead of the deployed site:

- `VITE_SYNC_API_BASE_URL=http://localhost:3000`

API runtime (Vercel project env for `/api/*` handlers):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- Optional: `CORS_ALLOWED_ORIGINS`

Never store these in local working app env files unless a separate admin-only tool explicitly requires them:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWT_SECRET`
- `VERCEL_OIDC_TOKEN`
- `POSTGRES_*`

Rotation policy:

1. Rotate privileged secrets immediately if exposed.
2. Remove them from local env files and deployment scopes that do not need them.
3. Validate app behavior with `npm run qa:check` and sync smoke tests.

## Local Cloud Sync Dev

To test `Sync Now` against local `/api/*` handlers instead of the deployed Vercel API:

1. Keep your frontend env in `.env.local` with `VITE_SYNC_API_BASE_URL=http://localhost:3000`.
2. Start the local Vercel API runtime in one terminal: `npx vercel dev --listen 3000`.
3. Start the frontend in a second terminal: `npm run dev`.
4. Open the app at `http://localhost:5173` and run sync there.

Notes:

- `npm run dev` only starts Vite. It does not run the `/api/*` handlers.
- `vercel dev` requires a valid Vercel login on your machine. If it fails with an invalid token, run `npx vercel login` first.
- Local sync still requires the API runtime env vars to be available: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, plus either `KV_REST_API_URL` and `KV_REST_API_TOKEN` or `STORAGE_KV_REST_API_URL` and `STORAGE_KV_REST_API_TOKEN`.

## Backup Format

Backup export/import supports:

- Full backup envelope (workout + templates + sync metadata)
- Legacy workout-only JSON backups (backward compatibility)

## QA

- Run tests: `npm run test`
- Smoke panel (dev): `/?qa=1`

## Observability

API handlers emit structured request lifecycle logs for `/api/workout-data` and `/api/templates` with:

- `requestId`
- `endpoint`
- `method`
- `status`
- `latencyMs`
- `userIdHash` (hashed and truncated)

Alert thresholds and incident steps:

- `docs/observability/alerting.md`
- `docs/observability/incident-runbook.md`