## Context

The repo already has several optimistic patterns, but they are inconsistent and assume live server access. Favorites optimistically toggle and roll back on error. Ratings optimistically update the local cache. Recipe edits and deletes still mostly rely on live mutation success plus later invalidation. Shared groceries and calendar hooks already have optimistic helpers, but the current mobile app surfaces for those domains are not yet the primary day-to-day mobile flows.

That makes this phase less about inventing optimism and more about applying it consistently to the first mutation families that should stop blocking offline users.

## Goals / Non-Goals

**Goals:**
- Enable immediate optimistic UI for the first allowlisted mobile cheap mutations.
- Queue supported offline commands instead of throwing a reachability error.
- Preserve latest local intent when the same device edits one entity multiple times before replay.
- Reuse the versioned/idempotent server contracts and durable outbox from the earlier phases.

**Non-Goals:**
- Make every mutable domain offline-capable in one release.
- Support temp-ID create flows, imports, uploads, or long-running jobs.
- Add per-item sync error UI or conflict-resolution screens.
- Replace authoritative repair via refetch with client-side merge logic.

## Decisions

### 1. Start with an explicit allowlist of cheap mobile mutation families

**Decision:** This phase SHALL first adopt the mutation families already exposed in active mobile surfaces and already well-suited to cheap replay-safe writes: desired-state favorites, ratings/set-style preference actions, and recipe edit/delete flows. Broader grocery and calendar adoption can follow after those mobile surfaces mature.

**Why:** Norish gets immediate product value by hardening the flows users can already perform in the mobile app, while avoiding a much larger first rollout across partially-built tabs.

**Alternatives considered:**
- Roll out every shared optimistic domain at once: rejected because it multiplies risk before the outbox model proves itself in mobile production flows.

### 2. Integrate offline behavior at mutation-hook edges

**Decision:** Offline enqueue and optimistic cache updates SHALL be added at hook edges in `packages/shared-react` or mobile-specific adapters, not reimplemented in every screen component.

**Why:** The repo already centralizes mutation behavior in shared hooks. Hook-edge integration keeps web/mobile behavior aligned where appropriate and reduces duplicated queue logic.

**Alternatives considered:**
- Per-screen enqueue logic: rejected because it would scatter replay rules and optimistic transforms across the app.

### 3. Keep authoritative truth, optimistic render state, and outbox command state conceptually separate

**Decision:** The rendered mobile UI SHALL continue to use React Query data for optimistic display, while the durable outbox remains the source of truth for pending write intent. Authoritative server truth is restored by invalidation/refetch when replay later reports conflict or missing state.

**Why:** This keeps the product responsive without requiring a full local database. It also matches the user's preference to distinguish server truth, local optimistic state, and command state.

**Alternatives considered:**
- Build a separate optimistic entity store first: rejected because it adds a second full client-state system before the cheap command model is proven.

### 4. Capture current entity version when the optimistic write is enqueued

**Decision:** Supported versioned mutation families SHALL read the current entity version from the cached query snapshot at enqueue time and persist it with the outbox command.

**Why:** Offline replay must compare against the user's last authoritative view, not whatever version happens to exist by the time replay starts.

**Alternatives considered:**
- Re-read version only at replay time: rejected because it would silently erase the stale-write signal.

### 5. Latest local intent wins for repeated same-device edits

**Decision:** When one device edits the same entity multiple times before replay, the UI SHALL continue showing the latest local intent and the queued command set SHALL compact to the latest replay-safe representation.

**Why:** Users experience their most recent change as the one that matters. Replaying every intermediate local keystroke or edit state only increases conflicts.

### 6. Unsupported or expensive mutation families remain blocked offline

**Decision:** Actions that need temp IDs, large payloads, uploads, imports, or long-running background processing SHALL continue to require live backend access and SHALL keep using the existing offline block behavior.

**Why:** This keeps the phase focused on the fast local-first actions that fit a durable cheap-command outbox.

## Risks / Trade-offs

- **[A mixed allowlist can feel inconsistent]** -> Mitigate with a clearly-defined supported family list and by leaving unsupported actions on the current explicit offline block path.
- **[Persisted optimistic query data can drift from server truth]** -> Mitigate through targeted invalidation/refetch in the reconciliation phase.
- **[Shared hooks may need mobile-specific branching]** -> Mitigate by keeping the branching at hook factories or adapters instead of screen components.

## Migration Plan

1. Introduce outbox-aware hook helpers without enabling them for every mutation family.
2. Opt in the first mobile allowlist one family at a time, starting with the most contained desired-state or edit/delete flows.
3. Validate replay, compaction, and refetch repair before considering broader grocery/calendar adoption.

## Open Questions

- Which mobile mutation family should be the very first enabled path: favorites, ratings, or recipe delete/edit?
- Do any additional mobile-owned preference mutations belong in the first allowlist?
- Should optimistic query projections be explicitly re-applied from the outbox on cold start, or is persisted query state sufficient for the first rollout?
