---
name: code-commenting-quality
description: Add or review code comments to improve readability by documenting non-obvious intent, constraints, tradeoffs, bug-fix reasoning, and integration assumptions; remove stale or redundant comments; use when asked to improve comments, maintainability, or explain tricky logic during code edits or reviews.
---

# Mission

Improve code readability with high-signal comments. Explain why/constraints, not line-by-line behavior.

## Workflow

1. Read changed code plus nearby comments.
2. Refactor naming/structure first if clarity can remove comment need.
3. Decide per location:
   - Add comment if reasoning is non-obvious.
   - Update/remove stale or redundant comments.
   - Choose no comment when code is self-explanatory.
4. Verify every kept/added comment matches current behavior.
5. Output a short Commenting Check summary.

## Rules (non-negotiable)

- Explain why, risk, constraint, or tradeoff; do not narrate what code does.
- Keep comments short, local, and durable.
- Prefer better names/extracted functions over explanatory prose.
- Never leave stale comments after behavior changes.
- Add source links for copied/derived logic or non-obvious external behavior.
- Use TODO only with:
  - what is missing
  - why deferred
  - done condition
- For bug fixes, state root cause and why the fix prevents recurrence.

## Required Comment Coverage

### 1) Public surfaces
Add TSDoc/JSDoc for exported functions/classes/types and entrypoints (API handlers, jobs, consumers) with:
- intent/guarantee
- key assumptions/constraints
- side effects (I/O, DB writes, external calls)
- params/returns only when non-obvious

### 2) Non-obvious decisions
Add a short why-comment for intentional tradeoffs, compatibility constraints, ordering requirements, or schema/infra limits.

### 3) Tricky logic
Comment dense business rules, regex/bitwise/numeric edge cases, concurrency/retry/idempotency/transaction boundaries, and security-sensitive checks (reasoning only, no secrets).

### 4) Integrations/adapters
Document API/SDK assumptions: timeout/retry/error/pagination/idempotency behavior; link reference when behavior is surprising.

### 5) Bug fixes
Document cause and prevention rationale; ensure tests cover the failure mode when appropriate.

### 6) Incomplete implementation
Use contextual TODO format from Rules.

## Disallowed / Discouraged

- Comments that restate code (“set x”, “increment i”).
- Boilerplate blocks repeating method names.
- Long narrative comments likely to drift from code.

## Signal Test (quick check)

- Bad: `// Increment index`
- Good: `// Use <= here to include the sentinel row required by downstream CSV parser.`

- Bad: `// Call API`
- Good: `// Provider returns 200 with partial failures; inspect 'errors' array before committing.`

## Required Output For Any Code Change

### Commenting Check
Return one of:
- 1–5 bullets listing comments added/updated/removed, or
- `Decision: No comment needed` + one-sentence reason.
