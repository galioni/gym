# Pending Improvements

Updated June 2026. Backlog is currently empty — all items shipped.

---

## Operational

### Push Notifications Env Vars
Add to Vercel project settings before push notifications will work in production:
- `VAPID_PUBLIC_KEY` — from `npx web-push generate-vapid-keys`
- `VAPID_PRIVATE_KEY` — from same command
- `VAPID_SUBJECT` — `mailto:your@email.com` or your app's URL
- `CRON_SECRET` — any long random string; Vercel auto-injects it into cron calls
