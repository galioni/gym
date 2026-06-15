# Pending Improvements

Updated June 2026.

---

## Feature: Per-User AI Provider Selection

Allow Pro users to choose their AI provider (Claude, ChatGPT, Gemini) for plan generation.
Free users are locked to Gemini. Gemini is always enabled; `AI_EXTRA_PROVIDERS` controls the optional additions.

### Phase 1 — Backend core ✓

- [x] **`api/_lib/apiEnv.ts`** — `getEnabledProviders()` and `getAiModelForProvider(provider)`
- [x] **`api/_lib/userSettingsKv.ts`** — KV helpers keyed at `user_settings:{userId}`
- [x] **`GET /api/ai-config`** — public; returns `{ enabledProviders: string[] }`
- [x] **`GET|PUT /api/user-settings`** — authenticated; tier-gated `aiProvider` preference
- [x] **`api/generate-plan.ts`** — per-user provider resolution with tier enforcement

### Phase 2 — Frontend ✓

- [x] **`features/settings/hooks/useUserSettings.ts`** — fetches `/api/ai-config` + `/api/user-settings`; optimistic `setAiProvider` with rollback
- [x] **`features/settings/components/AiProviderSelector.tsx`** — self-contained; inline SVG logos; Gemini always available; Claude/ChatGPT locked for free users; hidden when only one provider enabled
- [x] **`SettingsPage`** — `AiProviderSelector` added to AI Plan card above Regenerate button

### Operational

- [ ] Add `AI_EXTRA_PROVIDERS=anthropic,openai` to Vercel env vars (or a subset — omit any provider whose API key is not yet set)
- [ ] Add `ANTHROPIC_API_KEY` to Vercel env vars (already set: `AI_PROVIDER=anthropic` pending confirmation)
- [ ] Add `OPENAI_API_KEY` to Vercel env vars when/if ChatGPT is to be offered
