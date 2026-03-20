## Context

Norish already threads `operationId` from the client through the tRPC link, request context, and shared operation context, but that propagation only gives transport correlation today. The server does not yet persist receipts for replay deduplication, and a few write families still depend on implicit current-state behavior that becomes unsafe as soon as a mobile outbox retries them.

Current replay-unsafe inventory from the existing codebase:
- `favorites.toggle` in `packages/trpc/src/routers/favorites/favorites.ts` and `packages/db/src/repositories/favorites.ts` accepts only `{ recipeId }` and flips membership based on current server state.
- `groceries.checkRecurring` in `packages/trpc/src/routers/groceries/recurring.ts` accepts `{ recurringGroceryId, groceryId, isDone }`, but `isDone = true` also advances `nextPlannedFor` from current server state, so a duplicate replay can skip an occurrence.
- `toggleGrocery` in `packages/db/src/repositories/groceries.ts` still supports an omitted `isDone` that defaults to `!current.isDone`; it is not the main router path today, but it remains a replay-unsafe helper.

Already-desired-state contracts that should stay out of this sweep:
- `groceries.toggle` already carries `{ groceryIds, isDone }`.
- `user.apiKeys.toggle` already carries `{ keyId, enabled }`.

This change depends on the separate version-foundation change so version-aware edit and delete flows can rely on surfaced row versions. Its job is to migrate the unsafe mutation families in one coordinated pass and make duplicate replays deterministic.

## Goals / Non-Goals

**Goals:**
- Inventory the real replay-unsafe mutation families and migrate them in one coordinated sweep.
- Replace blind flip semantics with explicit desired-state or version-aware contracts.
- Return structured mutation outcomes that let callers distinguish `applied`, `duplicate`, `conflict`, and `gone` without transport-specific error handling.
- Persist operation receipts keyed by mutation family, actor scope, and `operationId` so duplicate replays return the original outcome without re-running side effects.
- Update client callers and optimistic state logic to use the new replay-safe contracts consistently.

**Non-Goals:**
- Introduce the base `version` columns or DTO exposure work handled by `offline-sync-versioned-mutations`.
- Build a general offline outbox executor or conflict-resolution UI.
- Retrofit long-running imports, uploads, or non-cheap background workflows in this pass.
- Rename every legacy helper immediately if the contract can be migrated safely first.

## Decisions

### 1. Migrate the actual unsafe inventory, not every toggle-named route

**Decision:** The sweep SHALL target mutation families whose semantics truly depend on current server state, starting with favorites and recurring grocery completion, while excluding toggle-named routes that already accept explicit desired state.

**Why:** The codebase already has misleading names such as `groceries.toggle` and `user.apiKeys.toggle` that are functionally replay-safe enough because the input declares the desired final state. Migrating by behavior avoids needless churn.

**Alternatives considered:**
- Convert every toggle-named procedure immediately: rejected because it mixes naming cleanup with replay-safety work and expands the blast radius.
- Only fix favorites for now: rejected because recurring grocery completion would remain a duplicate side-effect trap.

### 2. Use two replay-safe contract shapes

**Decision:** Replay-safe write families SHALL use one of two explicit contract shapes:
- desired-state set commands for boolean or relationship state, such as favorite membership;
- `expectedVersion` compare-and-swap commands for shared entity edits or deletes where stale writes must be rejected.

**Why:** Norish has both kinds of writes. For pure desired-state families, an idempotent set command is simpler than requiring a stored version. For shared mutable entities, `expectedVersion` makes stale writes explicit and composes with the version foundation.

**Alternatives considered:**
- Use compare-and-swap for every write, including favorites: rejected because some families are already safely expressed as set semantics.
- Rely only on operation receipts and keep toggle semantics: rejected because a duplicate-safe contract should still be readable and idempotent even before receipt lookup.

### 3. Return structured outcomes for expected replay cases

**Decision:** Replay-safe mutation responses SHALL use a discriminated outcome contract with explicit `applied`, `duplicate`, `conflict`, and `gone` cases instead of encoding expected replay results as opaque exceptions.

**Why:** Mobile and shared clients need to resolve queued commands deterministically. Structured outcomes let them clear, refetch, or surface a repair path without guessing whether the request reached the server.

**Alternatives considered:**
- Throw typed transport errors for conflict and missing state: rejected because it makes normal replay outcomes feel exceptional and complicates queue control flow.

### 4. Persist receipts with request fingerprinting

**Decision:** Replay-safe handlers SHALL persist a durable operation receipt keyed by mutation family, actor scope, and `operationId`, plus a request fingerprint that validates the duplicate really represents the same semantic command.

**Why:** `operationId` propagation already exists, but it does not prevent a lost response from causing the same write to run again. Fingerprinting also protects against accidental `operationId` reuse for a different payload.

**Alternatives considered:**
- Keep receipt lookup in memory only: rejected because retries can cross processes and restarts.
- Store a full request/response event log: rejected as heavier than needed for cheap mutation flows.

### 5. Derived side effects apply at most once

**Decision:** Replay-safe handlers SHALL bind any derived side effect to the first applied execution and SHALL reuse the stored receipt for duplicates instead of recomputing downstream work.

**Why:** Recurring grocery completion is not just a boolean update; it also advances schedule state. A duplicate replay must not advance `nextPlannedFor` a second time.

**Alternatives considered:**
- Recompute side effects on each duplicate and hope the result matches: rejected because schedule advancement and similar derived writes can diverge.

### 6. Migrate callers in one safe sweep, then remove legacy entry points

**Decision:** Shared schemas, routers, optimistic cache code, and legacy replay-unsafe entry points SHALL be migrated together in one coordinated pass so callers do not bounce between old and new semantics.

**Why:** Mixed semantics are the easiest way to reintroduce replay bugs. A single sweep makes testing and rollout clearer.

**Alternatives considered:**
- Leave legacy toggle endpoints indefinitely: rejected because they remain easy footguns for new callers.

## Risks / Trade-offs

- **[Broad contract churn across clients and routers]** -> Mitigate with shared schema types, one coordinated migration sweep, and targeted optimistic-cache updates.
- **[Receipt storage grows over time]** -> Mitigate with retention rules sized to expected offline replay windows.
- **[Duplicate-safe contracts may still be misused with stale local state]** -> Mitigate with explicit `conflict` and `gone` outcomes plus follow-up refetch behavior.
- **[Recurring side effects are easy to under-specify]** -> Mitigate with dedicated regression tests that prove retries do not re-run schedule advancement.

## Migration Plan

1. Finish the version-foundation change so version-aware write families can rely on surfaced `version` values.
2. Add shared mutation outcome schemas and durable operation receipt persistence with request fingerprint validation.
3. Migrate the identified replay-unsafe families, optimistic client callers, and tests in one coordinated sweep.
4. Remove or reject legacy replay-unsafe entry points once all supported callers use the new contracts.

## Open Questions

- Should the favorite migration expose one `setFavorite` endpoint or a pair of explicit add/remove endpoints at the router surface?
- Should `duplicate` outcomes echo the original resolved entity version when available, or should clients rely on refetch after duplicate detection?
