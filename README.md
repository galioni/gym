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

## Backup Format

Backup export/import supports:

- Full backup envelope (workout + templates + sync metadata)
- Legacy workout-only JSON backups (backward compatibility)

## QA

- Run tests: `npm run test`
- Smoke panel (dev): `/?qa=1`
