# Observability Alert Thresholds

This app emits structured API lifecycle logs from:

- `/api/workout-data`
- `/api/templates`

## Required log fields

- `event` (`api.request.completed` or `api.request.error`)
- `requestId`
- `endpoint`
- `method`
- `status`
- `latencyMs`
- `userIdHash` (nullable for unauthenticated requests)

## Alert thresholds

Evaluate over a rolling 5-minute window per environment:

1. `api_5xx_rate_warning`
- Condition: `% of api.request.completed where status >= 500` is `>= 2%` with at least `20` total requests.
- Severity: warning.

2. `api_5xx_rate_critical`
- Condition: `% of api.request.completed where status >= 500` is `>= 5%` with at least `20` total requests.
- Severity: critical.

3. `api_auth_failures_warning`
- Condition: count of `api.request.completed` where `status in [401, 403]` is `>= 20` in 5 minutes.
- Severity: warning.

4. `api_auth_failures_critical`
- Condition: count of `api.request.completed` where `status in [401, 403]` is `>= 50` in 5 minutes.
- Severity: critical.

## Synthetic failure validation

Run these checks against preview/staging before enabling production paging:

1. Auth failure alert test:
- Send at least 25 unauthenticated requests to `/api/workout-data` within 5 minutes.
- Verify `api_auth_failures_warning` triggers.

Example:

```bash
for i in {1..25}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://<your-preview-domain>/api/workout-data
done
```

2. 5xx alert test:
- In preview only, temporarily set an invalid `KV_REST_API_URL` value and redeploy.
- Send at least 20 authenticated sync requests in 5 minutes.
- Verify `api_5xx_rate_warning` triggers.
- Revert env and confirm alert recovers.
