# API Incident Runbook

Scope: `/api/workout-data` and `/api/templates`.

## 1) Triage

1. Confirm active alerts and environment (preview vs production).
2. Query latest `api.request.completed` logs grouped by:
- `endpoint`
- `status`
- `latencyMs` percentiles
3. Check `api.request.error` logs by `requestId` to correlate failures.

## 2) Classify

Use this quick mapping:

- Mostly `401`/`403`: auth/session problems.
- Mostly `429`: abusive traffic or limiter too strict.
- Mostly `413`: sync payload growth regression.
- Mostly `5xx`: upstream config/dependency failure (KV/Supabase/env).

## 3) Immediate containment

1. If `5xx` spike is caused by bad deployment env, rollback or restore last known-good env values.
2. If abusive traffic dominates, temporarily tighten CORS allowlist and keep rate limiting enabled.
3. If auth failures spike after deploy, rollback auth-related changes and verify token validation env vars.

## 4) Recovery verification

1. Confirm alert conditions are below threshold for at least 10 minutes.
2. Run synthetic checks from `docs/observability/alerting.md`.
3. Verify request logs show normal mix of `200`/`404` and stable latency.

## 5) Post-incident

1. Capture incident summary:
- start/end time
- user impact
- root cause
- fix
- follow-up actions
2. Add a regression test if failure mode was code-related.
