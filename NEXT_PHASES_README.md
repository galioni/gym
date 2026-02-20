# Next Phases (Future Work Only)

This file tracks only upcoming phases and steps. It does not track completed work.

## Current Phase
Phase 9 (Planned)

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
