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
  - Custom SMTP is set up (2026-10-01): Resend, domain `gym.solutionsnot.ltd` (DKIM + two CNAMEs at the DNS host),
    sender `no-reply@gym.solutionsnot.ltd`, Supabase rate limit 30 emails/hour. Verified with a real sign-up:
    delivered to the inbox in about 2 seconds with a correct confirmation link. Resend free tier: 3,000 emails/month.
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

- [ ] **Plan tiers** (see the Free/Pro table under "Decisions"): plan-aware `row_limit()`, a sync allowance for free
  accounts with clear status text ("next sync available on …"), the cloud-only 7-day window, a plan-aware AI rate limit, and
  upgrade prompts at each limit. Build after subscriptions are in Postgres
- [x] Subscriptions (slice 15.1, 2026-10-01): billing state is in Postgres. `subscriptions` holds the plan and, through a unique
  `stripe_customer_id`, the customer-to-user link; `stripe_events` de-duplicates webhooks (purged after 30 days by `pg_cron`).
  `subscriptionGuard`, the webhook, checkout, billing portal, `user-settings` and delete-account use it; a webhook lookup that
  hits a database error now answers 5xx so Stripe retries, instead of dropping the event. Shipped as two PRs because migrations
  apply on merge: schema first, then code. Nothing was migrated from KV (no subscribers). The `subscription:*`,
  `stripe_customer:*` and `stripe_event:*` KV keys are now unused
- [x] User settings (slice 15.2, 2026-10-01): the AI provider is `user_settings.ai_provider`; `api/user-settings` and `api/generate-plan` use it
  through the service role. No schema change. The Pro rule is enforced where the provider is *used* (`resolveAiProvider`), because the
  column is writable by its owner; `GET` reports the effective provider. The `user_settings:*` KV keys are now unused
- [x] Push notifications (slice 15.3, 2026-10-01): **removed, not migrated.** The feature was not live: its server routes were deleted on
  2026-06-15 (commit `dc44861`), nothing scheduled it, and the Settings card was never rendered. The dead client hook and card,
  `pushKv`, the VAPID helpers, the service worker push handlers and the `web-push` dependency are gone. To bring it back, build it on
  Postgres (a `push_subscriptions` table, subscribe and public-key routes, a daily reminder job) rather than restoring the old code from git.
  The `VAPID_*` and `CRON_SECRET` variables in Vercel are now unused and can be deleted there
- [ ] Rate limiting: replace the KV counters (Postgres counter table or a hosted limiter)
- [ ] `delete-account`: drop the legacy KV key deletion once those keys are gone
- [ ] Remove `STORAGE_KV_*` / `KV_REST_API_*` env vars and the `kv`, `kv-rest` services from `docker/compose.yaml`
- [ ] Update README (data stores, env vars, local stack table)

## Phase 16 — Sync performance and freshness  _(size: M; only when data volume or latency justifies it)_

- [ ] Incremental pull (`updated_at > cursor` with a small overlap window) instead of reading every row each sync
- [ ] Faster cross-device updates: Supabase Realtime or a lighter poll (today: on focus, on reconnect, every 5 minutes)
- [x] **Retention (decided: 90 days). Done and live (2026-10-01).** A trigger blanks a deleted day's content; the client
  stores the content hash in `deleted_hash` so cross-device deletes still work; `purge_deleted_days()` runs daily via
  `pg_cron` (03:17 UTC, job `purge-deleted-days`), executable only by `postgres`. Verified on production with a rolled-back
  delete (content blank, hash kept), privileges and advisors. Migration `20261001110000_deleted_day_retention`.
  - **Operational finding:** merging to `main` applied this migration to the hosted project **automatically** (the Supabase
    GitHub integration is deploying migrations). A migration therefore reaches production when its PR merges, so review the
    SQL in the PR and make the client code tolerate the old schema, or merge the migration PR before the client PR
- [ ] Bound the size of local restore points (each one stores a full snapshot, up to 10 of them)

## Phase 17 — Tooling and developer experience  _(size: S to M)_

- [ ] Add `supabase/config.toml` so the Supabase CLI can `link` and `db push` the same migrations
- [ ] Generate TypeScript types from the schema instead of the hand-written row types in `postgresRows.ts`
- [ ] Seed script for demo data on the local stack; `gym:psql` shortcut; backup/restore of the local Postgres volume
- [ ] API container hot reload is unreliable on Windows bind mounts (`npm run gym:restart api` as a workaround)
- [ ] Re-run `npm audit`; keep `@supabase/postgrest-js` and `tsx` current

---

## Decisions needed from the owner

Decided 2026-10-01:

- [x] **What is Pro for?** Pro is the full product; **Free is deliberately small** (owner's choice, 2026-10-01, over
  the recommendation of a more generous free tier). Subscriptions move to the Postgres `subscriptions` table and
  Stripe stays (Phase 15). Pricing, landing page and Settings copy must say this plainly.

  | | Free | Pro |
  |---|---|---|
  | Cloud sync | one sync per rolling 30 days (manual "Sync now"; automatic sync off) | automatic, unlimited |
  | Templates | 1 | 200 |
  | Cloud history | last 7 days | all (up to the row limit) |
  | Plans | 20 (one fifth of Pro) | 100 |
  | Workout days (safety cap) | 1,000 (one fifth of Pro) | 5,000 |
  | AI plan generation | 1 per day, Google model | 10 per hour, choice of model |

  Everything stays fully usable **locally** on a free account; the limits apply to what is stored and synced in the cloud.
  Known consequences, accepted by the owner: low retention is likely; with 1 template the plans cap is mostly moot and with
  a 7-day window the 1,000-day cap never binds; free users can lose up to a month of unsynced work if a device is lost.
  Open design questions before building (Phase 15, "Plan tiers"):
  - What counts as "a sync"? Proposal: one successful upload+download cycle; the first pull on a brand-new device does not count.
  - The 7-day window must be a **cloud-only** rule. Rows older than 7 days are neither uploaded nor treated as deleted, or the
    sync would read them as deletions and erase local history. This needs a change in `deletionReconciliation` and tests.
  - Downgrade behaviour: a Pro user who lapses with 30 templates keeps them locally and read-only in the cloud; nothing is deleted.
  - Free "1 template" is enforced in the client and by the database trigger (`row_limit` becomes plan-aware).
- [x] **Soft-deleted data retention: 90 days.** A scheduled job permanently erases deleted days after 90 days, and the
  exercise content of a deleted day is blanked straight away so only the deletion marker syncs. New work, see Phase 16.
  A full data export was not decided; still open as a product question.
- [x] **Row limits:** keep 5,000 days, 200 templates and 100 plans per account.
- [x] **Source control:** done, work is merged to `main` through reviewed PRs.

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
