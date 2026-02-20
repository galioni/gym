# Next Phases (Future Work Only)

This file tracks only upcoming phases and steps. It does not track completed work.

## Current Phase: Phase 3 (In Progress)

## Phase 3: Validation and QA
1. Run auth flow smoke tests:
   - Sign in with Google
   - Sign out
   - Session restore after reload
2. Run sync flow tests:
   - Switch to cloud mode
   - Sync workout data and templates
   - Verify reads/writes per authenticated user
3. Redeploy latest API/frontend build and verify runtime envs are attached.
4. Run negative auth tests:
   - No bearer token -> `401`
   - Invalid bearer token -> `401`
5. Run regression checks for workout/template UX.

## Phase 4: Deployment and Stabilization
1. Deploy API updates.
2. Deploy frontend updates.
3. Validate end-to-end in production with fresh browser profile.
4. Verify user data isolation across different accounts.
5. Monitor auth/sync errors and fix rollout issues.
6. Remove any remaining legacy static-key auth documentation/config.
