# Next Phases (Future Work Only)

This file tracks only upcoming phases and steps. It does not track completed work.

## Current Phase
Phase 6 (Planned)

## Phase 6: Secret Hygiene and Access Hardening (Priority 1)
1. Rotate exposed high-privilege secrets (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, DB passwords, OIDC token).
2. Remove unused privileged env vars from local and deployment environments.
3. Keep only minimum required env vars per runtime (client vs API).
4. Document env ownership and least-privilege policy in README.
Acceptance criteria:
1. No high-privilege secrets remain in local working env files unless strictly required.
2. Production and local app behavior are unchanged after rotation.
3. Env inventory is documented and reviewed.

## Phase 7: API Abuse Protection (Priority 2)
1. Add rate limiting to `/api/workout-data` and `/api/templates`.
2. Add strict request content-type checks (`application/json`) for PUT.
3. Add request body size caps for sync payloads.
4. Return explicit `429`/`413` for abuse/oversized requests.
Acceptance criteria:
1. Excess request bursts are throttled with `429`.
2. Oversized payloads are rejected with `413`.
3. Normal sync usage is unaffected.

## Phase 8: Observability and Alerting (Priority 3)
1. Add structured logs with request id, endpoint, user id hash, latency, status.
2. Define alert thresholds for 5xx rate and auth failures.
3. Add short runbook for incident triage.
Acceptance criteria:
1. Key request lifecycle fields are visible in production logs.
2. Alerting triggers on synthetic failure tests.
3. Runbook is available and actionable.

## Phase 9: Data Reliability and Recovery (Priority 4)
1. Add payload schema/version validation before write.
2. Add migration guard for future schema upgrades.
3. Add restore-point verification workflow tests.
Acceptance criteria:
1. Invalid payloads are rejected safely.
2. Backward-compatible migrations are verified in tests.
3. Restore flows recover expected snapshots.

## Phase 10: E2E Release Gates (Priority 5)
1. Add Playwright end-to-end tests for login, sync now, reload persistence, and account isolation.
2. Gate production deploy on passing critical E2E scenarios.
3. Add basic smoke job for `/?qa=1` checks.
Acceptance criteria:
1. CI fails on regression in auth/sync critical path.
2. Deploy pipeline blocks on failing critical E2E tests.
3. Release confidence improves with repeatable smoke checks.
