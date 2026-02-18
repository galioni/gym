---
name: Pattern-First-Architecture
description: >
  Enforces a pattern-first approach when generating TypeScript/Node.js code,
  applying Repository and Generic Repository patterns with strict separation
  of concerns and safety guardrails.
applies_to:
  - TypeScript
  - Node.js
  - Backend
  - Architecture
  - Refactoring
priority: high
---

## Mission

When generating or modifying code, **default to a pattern-first design** that:
- Separates business logic from infrastructure
- Uses repositories as the sole data-access boundary
- Applies Generic Repository patterns safely
- Avoids exposing unsafe or misleading CRUD APIs

---

## Core Principles

1. **Separation of Concerns**
   - Domain and application layers must never depend on DB drivers, ORMs, or query builders.
   - All persistence logic lives behind repositories.

2. **Open/Closed Principle**
   - Extend abstractions instead of duplicating or modifying core logic.
   - Shared behaviour belongs in base classes or shared contracts.

3. **Generic Reuse, Not Generic Leakage**
   - Use generics to eliminate duplicated CRUD logic.
   - Never expose generic operations that violate domain rules.

4. **Safety Over Convenience**
   - Do not expose `update`, `delete`, or similar operations unless they are explicitly valid for the entity.

---

## Required Architectural Layers

Every generated solution must respect these logical layers:

- **domain/**
  - Entities, value objects, domain rules
  - No persistence or framework code

- **application/**
  - Use cases / application services
  - Orchestrates domain + repositories

- **interfaces/** (or **ports/**)
  - Repository contracts used by the application layer

- **infrastructure/**
  - Repository implementations
  - Database clients, ORM adapters, mappers

Folder names may vary, **responsibilities must not**.

---

## Repository Pattern Rules

### 1. Define Repository Contracts First

- Repositories are accessed through interfaces.
- Prefer split contracts when appropriate:
  - Read-only (`find`, `findById`, `list`)
  - Write (`create`, `update`, `delete`)
- Application code depends only on these interfaces.

---

### 2. Implement a Generic Base Repository

- Create a reusable `BaseRepository<T>` (or equivalent).
- Implement shared CRUD logic **once** using generics.
- Configure via constructor injection (DB client, model, table name, etc.).
- No domain logic inside the base repository.

Example intent (not required syntax):

- `BaseRepository<T>`
- `EntityRepository extends BaseRepository<Entity>`

---

### 3. Use Entity-Specific Repositories

- Each entity has its own repository class.
- Entity repositories:
  - Extend the base repository
  - Add entity-specific queries or behaviours
- Never put entity-specific logic in the generic base.

---

## Guardrails: When Generic Repositories Must Be Restricted

If an entity has **business constraints** such as:
- Partial immutability
- Restricted updates
- Domain-specific actions (e.g. credit/debit, approve/reject)

Then **do not expose generic CRUD blindly**.

Codex must enforce safety using **one or more** of the following:

1. **Split Interfaces**
   - Implement only `ReadRepository<T>` where writes are forbidden.

2. **Specialised Methods**
   - Replace `update()` with explicit intent methods
     (e.g. `credit()`, `archive()`, `activate()`).

3. **Protected Base Methods**
   - Keep generic CRUD protected.
   - Expose only allowed operations from concrete repositories.

4. **Use-Case Enforcement**
   - Only application use cases can invoke sensitive operations.
   - Repositories never bypass domain rules.

---

## Mandatory Pre-Generation Checklist

Before finalising code, the agent must verify:

1. Domain rules and invariants are identified
2. Repository boundaries are clearly defined
3. Repository contracts exist and are used by the application layer
4. Generic repositories do not expose unsafe operations
5. Infrastructure code is isolated
6. Business logic is testable with mocked repositories

---

## Code Conventions

- Prefer explicit types and meaningful generics
- Use constructor dependency injection
- Repositories must be stateless
- No global DB access
- Clear, predictable error handling

---

## Definition of Done

A solution is complete only if:

- Business logic does **not** import DB drivers or ORM models
- Shared CRUD logic is implemented once via a generic base (when valid)
- Entity rules are enforced via restricted APIs or specialised methods
- Application logic depends only on repository interfaces
- Use cases can be unit-tested with repository mocks

