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
3. Run regression checks for workout/template UX.

## Phase 4: Deployment and Stabilization
1. Deploy API updates.
2. Deploy frontend updates.
3. Validate end-to-end in production with fresh browser profile.
4. Verify user data isolation across different accounts.
5. Monitor auth/sync errors and fix rollout issues.
6. Remove any remaining legacy static-key auth documentation/config.

## Phase 5: Cloud-Only Sync Mode
1. Remove local/cloud mode toggle from the sync settings UI.
2. Update sync contracts/types to cloud-only mode.
3. Remove local-mode logic branches from sync application services.
4. Fail loudly if cloud sync env configuration is missing.
5. Update tests to reflect cloud-only behavior.
6. Update docs and env examples to remove local sync mode references.
