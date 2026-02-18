---
name: Design-Pattern-Advisor
description: For any code change, analyse the feature, decide whether a design pattern is warranted, and if so propose and implement a minimal, justified pattern choice; “no pattern” is allowed and often preferred.
---

## Mission

For any feature, refactor, or bugfix that creates or changes code, produce a **Pattern Decision** and then implement the change accordingly.

This skill is not about forcing patterns. It is about:
- recognising when a pattern helps,
- selecting the simplest appropriate pattern,
- and avoiding unnecessary complexity.

## Non-negotiables

- **“No pattern” is allowed** and is often the correct decision.
- Prefer the **simplest design** that meets requirements.
- If a pattern is used, use **one primary pattern** (and at most one alternative).
- Implement patterns **minimally**: no frameworks, no abstractions without a clear need.

## Pattern Decision (required output before code)

Before writing or editing code, output this short section:

### Pattern Decision
- Context: What is changing and why (1–3 bullets).
- Signals: Which forces exist (variation, coupling, complexity, lifecycle, integration, testability).
- Decision: **No pattern** OR **Use <PatternName>**.
- Rationale: 2–5 sentences (include trade-offs).
- Scope: Where it applies (which modules/files).
- Guardrails: What you will NOT do (to prevent overengineering).

If **No pattern**:
- Provide a brief justification (1–2 sentences), and implement with clean, straightforward code.

## When a pattern is warranted (selection signals)

Recommend a pattern only when at least one is true:
- You see repeated conditional logic that will grow (“if/else ladder”, “switch explosion”).
- You expect multiple interchangeable strategies/algorithms.
- You need to decouple subsystems that currently know too much about each other.
- You are integrating a third-party API that should not leak into domain/application code.
- You need a stable workflow with variable steps.
- You need durable action encapsulation (queueing, retries, logging, undo/audit).

## Pattern selection guide (use as a heuristic)

Pick the **closest match** and keep it minimal:

- **Strategy**: interchangeable algorithms/rules (pricing, scoring, validation rulesets).
- **Factory Method / Abstract Factory**: creation varies by config/runtime/environment.
- **Adapter**: wrap external APIs/SDKs so internal code stays stable.
- **Facade**: simplify a complex subsystem behind a small interface.
- **Decorator**: optional behaviours without subclass explosion.
- **Observer (Pub/Sub)**: event-driven reactions without tight coupling.
- **Command**: encapsulate actions for queues, retries, audit, or undo.
- **State**: behaviour varies heavily by lifecycle/state transitions.
- **Template Method**: fixed workflow structure, variable steps.
- **Chain of Responsibility**: pipeline/handlers where order may change.

## Implementation rules

- Add only the abstractions needed to solve the stated problem.
- Name abstractions by intent (not by pattern), e.g. `PricingStrategy`, `EmailProviderAdapter`.
- Keep construction simple; prefer explicit wiring over magic.
- If you introduce interfaces, ensure at least one clear consumer and one test seam.

## Definition of Done

A change is complete only if:
- A **Pattern Decision** is documented (even if “No pattern”).
- The change is implemented with minimal complexity.
- If a pattern is used, it measurably improves clarity, extensibility, or testability for this change.

