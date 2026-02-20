# QA Guardrails

Use these lightweight checks after major UI or state refactors.

## Automated tests

1. Install dependencies so `vitest` is available.
2. Run: `npm run test`
3. Focused suites live under `application/workout/`.

## Smoke checks

1. Start dev server: `npm run dev`
2. Open: `http://localhost:5173/?qa=1`
3. Confirm all items in **QA Smoke Panel** show `PASS`.

## Visual baseline pass

Capture screenshots for:

1. Header (desktop and mobile menu open)
2. Warm-up section card with at least one completed item
3. Main section with RPE select visible
4. Daily check card
5. Sticky footer at 0% and non-zero progress
