# Next Phases (Future Work Only)

This file tracks only upcoming phases and steps. It does not track completed work.
Operational items for the AI-provider feature live in [`PENDING.md`](../PENDING.md).

## Where things stand

Postgres (with row level security) is the source of truth for every signed-in user and sync is automatic.
It is built and verified against the local Docker stack (`npm run gym:up`); **nothing has been applied to the
hosted Supabase project or deployed**. The legacy Pro-only API/KV sync has been removed from the code.
Everything below is what stands between this state and a safe production release, plus follow-up work.

Verification gates used throughout (all must stay green):

```bash
npx tsc --noEmit && npx vitest run && npx eslint . && npx vite build
npm run gym:up && npm run gym:test-db && npm run gym:test-sync && npm run gym:down
```

## Current Phase

**Phase 14 — Production rollout.** It is approval-gated at every step that touches production. One decision (what Pro is for) is still open and affects copy, not code.

---

## Phase 14 — Production rollout  _(size: S to M; every step that touches production needs explicit approval)_

Decision already made: **start with a fresh production database; no KV import.** Existing users' data in their
browsers is claimed by their account and uploaded on their first sign-in. History that exists only in KV is
intentionally left behind.

- [x] Back up the hosted database: skipped by decision, the project was empty (fresh database, no KV import)
- [x] Run Supabase advisors (security and performance) on the project (2026-10-01, after the migrations)
- [x] Review hosted Auth settings (2026-10-01): email confirmation on, anonymous sign-ins off, Google + email only,
  password policy tightened, Site URL `https://gym-galioni.vercel.app`, redirect allow-list reduced to that domain
  and the team's preview wildcard (`localhost` removed), Google callback URI confirmed
  - Accepted warning: leaked-password protection needs the Pro plan; mitigated by the stronger password policy
  - Accepted warning: GraphQL lists the table names to signed-in users; RLS still limits rows to their owner
  - **Launch blocker:** the built-in email service only delivers to organisation members and is heavily rate
    limited. Set up custom SMTP before real users sign up. Not needed for the preview test with an address we control.
- [x] Apply `supabase/migrations` to the hosted project (2026-10-01, three migrations, history names match the files)
- [x] Deploy a Vercel preview against the hosted project; sign in with a real account; verify upload, a second browser, a delete
  (2026-10-01: passed with Google sign-in on branch `phase-14-postgres-sync`; test rows removed)
  - Found and fixed: sign-in returned to the fixed `VITE_SUPABASE_REDIRECT_URL` (production), so a preview test
    silently exercised the old build. Auth now returns to the current origin **with a trailing slash**
    (allow-list patterns like `https://host/**` do not match a bare origin)
  - The three pre-existing production accounts were deleted on request (no subscriptions, no clients)
- [ ] Deploy to production; watch logs and error rates for the first day; keep the previous deployment ready to roll back
- [ ] Optional: delete the orphaned `sync:{userId}:*` keys from KV once nobody needs the rollback

Rollback: redeploy the previous build (browsers keep working from their local copy); the new tables are additive and
can stay in place.

## Phase 15 — Retire KV  _(size: L, 1 to 2 days; do as its own change so it is easy to revert)_

KV is still used for billing state, user settings, push subscriptions and rate limits.

- [ ] Subscriptions: read and write the `subscriptions` table (Stripe webhook writes it with the service role; the
  client can read its own row under RLS); migrate `api/subscription`, `api/_lib/subscriptionGuard.ts`, the webhook
- [ ] User settings (AI provider): use `user_settings`; migrate `api/user-settings` and `api/generate-plan`
- [ ] Push subscriptions and reminder de-duplication: new table(s) plus a migration; the `/api/push-*` routes the client
  calls are not present in `api/` yet, confirm whether the feature is live before porting
- [ ] Rate limiting: replace the KV counters (Postgres counter table or a hosted limiter)
- [ ] `delete-account`: drop the legacy KV key deletion once those keys are gone
- [ ] Remove `STORAGE_KV_*` / `KV_REST_API_*` env vars and the `kv`, `kv-rest` services from `docker/compose.yaml`
- [ ] Update README (data stores, env vars, local stack table)

## Phase 16 — Sync performance and freshness  _(size: M; only when data volume or latency justifies it)_

- [ ] Incremental pull (`updated_at > cursor` with a small overlap window) instead of reading every row each sync
- [ ] Faster cross-device updates: Supabase Realtime or a lighter poll (today: on focus, on reconnect, every 5 minutes)
- [ ] Scheduled purge of soft-deleted days older than a retention period (the row content is kept after a delete)
- [ ] Bound the size of local restore points (each one stores a full snapshot, up to 10 of them)

## Phase 17 — Tooling and developer experience  _(size: S to M)_

- [ ] Add `supabase/config.toml` so the Supabase CLI can `link` and `db push` the same migrations
- [ ] Generate TypeScript types from the schema instead of the hand-written row types in `postgresRows.ts`
- [ ] Seed script for demo data on the local stack; `gym:psql` shortcut; backup/restore of the local Postgres volume
- [ ] API container hot reload is unreliable on Windows bind mounts (`npm run gym:restart api` as a workaround)
- [ ] Re-run `npm audit`; keep `@supabase/postgrest-js` and `tsx` current

---

## Decisions needed from the owner

- [ ] **What is Pro for?** With sync free, the only Pro benefit in the product is choosing the AI model. Pricing, landing
  page and Settings copy depend on this.
- [ ] **Soft-deleted data retention:** a deleted day keeps its content in the database (marked deleted). How long, and is
  that acceptable for the privacy policy? Also whether to offer a full data export.
- [ ] **Row limits:** shipped with defaults of 5,000 days, 200 templates and 100 plans per account. Confirm they suit you; changing them is one new migration replacing `row_limit()`.
- [ ] **Source control:** this work spans several workstreams and is not committed. Suggested commits on a branch:
  theme, Docker stack, database and migrations, client sync, legacy-sync removal.

## Known limitations (accepted for now)

- The `stack` CI job was rehearsed locally from a clean checkout and an empty database, but has not yet run on GitHub.
  Its first run may need tuning (Docker Hub pull limits, runner time).
- Two devices changing the very same day, template or plan is a conflict the user must resolve; anything else merges silently. A reorder of templates or plans on its own is not detected as a change.
- Whether onboarding is done is not synced on purpose (re-running the wizard clears it). A new browser skips onboarding because synced data arrives; an account that has no synced data yet still sees the wizard.
- Sign-out does not clear local data. A different account signing in on the same browser is blocked until the user
  chooses to switch (which removes the other account's local data from that browser).
- A browser that never re-syncs keeps its own copy; there is no server-initiated push.
- A sync request that would cross an account's row limit is rejected whole (batches are 200 rows), so up to 199 rows below the limit may stay unsynced until some room is freed.
- Sync relies on the browser's `localStorage` quota; very large histories on one device are untested.

## Completed Phases (for reference)

- Phase 13: Sync UX — header status indicator (synced / syncing / offline / needs attention) driven by one tested rule set, automatic sync as the Settings story, per-item three-way merge for templates and plans (edits to different items never conflict; deletions propagate; an edit beats a delete), active plan and plan details follow the account, real buttons for conflict choices plus an explicit "Apply choices and sync", toasts below the header, Escape closes the mobile menu, the Rebuild-plan wizard can no longer be dismissed by an incoming sync
- Phase 12: Quality gates — ESLint clean (CI now fails on any warning), CI job that boots the real stack from an empty database and runs the SQL, API and two-browser suites on Chromium, WebKit and an iPhone profile, `useAutoSync` unit tests (19), dark and light contrast audit enforced by a test (WCAG AA), visual pass of the remaining screens, modal focus verified for every dialog
- Phase 11: Data safety limits — per-account row caps enforced in Postgres (race-safe, edits unaffected), a clear `PT422` error end to end, a once-only "storage limit reached" notice, tests at SQL, HTTP, unit and browser level
- Phase 9: Data Reliability and Recovery — migration guards, write guards, restore-point verification tests
- Phase 10: E2E Release Gates — Playwright smoke suite, CI gating, QA smoke test integration
- Light theme (Apple HIG) with System/Light/Dark toggle, semantic design tokens, contrast-audited palette, modal focus handling, on-demand webfonts
- Local Docker stack `gym-app` (Postgres, Auth, REST, gateway, KV, mail, Stripe mock, Studio; nothing auto-starts)
- Postgres schema, row level security and migration runner, with database tests and an API smoke test
- Automatic Postgres sync: three-way merge, propagated deletions, account-ownership guard, no-clobber local writes,
  stale-state reload, two-browser end-to-end test
- Removal of the legacy Pro-only API/KV sync path (single backend: Postgres)
