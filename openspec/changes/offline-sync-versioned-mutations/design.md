## Context

Norish already propagates `operationId` from client mutations through tRPC context, queue boundaries, and realtime envelopes, but that contract is explicitly transport-scoped. The server still applies most cheap mutations as ordinary live writes: mutable entities expose `updatedAt` but not a monotonic version, repositories mostly update rows without compare-and-swap checks, and some APIs use replay-unsafe toggle semantics.

That means a mobile outbox would know which command it sent, but not whether the command still matches current server state or whether a retried request is safe to run twice. This is most acute for collaborative entities such as recipes, groceries, and planned items, where another device can change or delete data while one phone is offline.

## Goals / Non-Goals

**Goals:**
- Add explicit entity `version` tokens for the mutable entities used by the first offline-write rollout.
- Require replay-safe edit/delete flows to carry `expectedVersion` and resolve with deterministic outcomes.
- Replace replay-unsafe toggle semantics with desired-state semantics where retries must remain safe.
- Add server-side operation receipts keyed by `operationId` so duplicate replays do not double-apply.
- Give mobile a direct mutation outcome contract it can use to clear, retry, or repair outbox items without waiting for websocket timing.

**Non-Goals:**
- Version every table in the database in one sweep.
- Build field-level merge tooling or manual conflict resolution UI.
- Use `updatedAt` or client timestamps for optimistic concurrency.
- Cover imports, uploads, temp-ID create flows, or other long-running work in this phase.
- Replace realtime envelopes as the transport contract for correlation.

## Decisions

### 1. Use integer `version` for optimistic concurrency

**Decision:** Replay-safe mutable entities SHALL carry a monotonically increasing integer `version`, starting at `1` for newly-created rows and incrementing once for each successful mutation that changes authoritative state.

**Why:** Integer versions express concurrency intent directly and avoid timestamp precision, clock-skew, and serialization ambiguity. They also let the client persist a compact base version alongside an offline command.

**Alternatives considered:**
- `updatedAt` compare-and-swap: rejected because it is harder to treat as a strict concurrency token and is vulnerable to precision drift.
- Payload hashing: rejected because minor server-side normalization would create false conflicts.

### 2. Carry `expectedVersion` in replay-safe mutation inputs

**Decision:** Edit and delete mutations that participate in offline replay SHALL accept an explicit `expectedVersion` in their input contract and SHALL refuse to apply when the stored entity version differs.

**Why:** Norish already uses typed tRPC DTOs. Carrying the concurrency token in the mutation input keeps the rule visible at the contract boundary, easy to persist in the outbox, and simple to test.

**Alternatives considered:**
- Hidden headers or context-only version metadata: rejected because it obscures the contract and makes typed outbox persistence harder.
- Query-time only detection: rejected because stale state must be caught at write time.

### 3. Use set-style semantics for replay-safe toggle families

**Decision:** Replay-safe mutation families SHALL express desired state rather than implicit toggles when a retried request could otherwise flip state twice. Favorites are the clearest example: the replay-safe contract should be `set favorite = true|false`, not `toggle favorite`.

**Why:** A duplicate replay of an idempotent set command is harmless. A duplicate replay of a toggle command is not.

**Alternatives considered:**
- Keep toggles and rely only on operation receipts: rejected because set semantics are still clearer for concurrency, retries, and compaction.
- Push toggle resolution entirely to the client: rejected because the server still needs replay-safe behavior.

### 4. Add server-side operation receipts for replay-safe commands

**Decision:** Replay-safe mutations SHALL persist an operation receipt keyed by at least mutation family, actor scope, and `operationId`. The receipt SHALL store the resolved outcome class and enough target metadata for a duplicate request to return the same outcome without reapplying business logic.

**Why:** `operationId` propagation already exists, but it currently does not deduplicate writes. A durable receipt closes the gap between transport correlation and replay safety.

**Alternatives considered:**
- No receipt store, only compare-and-swap: rejected because a lost HTTP response could still cause duplicate application on retry.
- Full request/response replay log: rejected as heavier than needed for cheap mutation flows.

### 5. Return structured replay outcomes instead of treating expected conflicts as opaque exceptions

**Decision:** Replay-safe mutation contracts SHALL return a small discriminated outcome for expected write results such as `applied`, `duplicate`, `conflict`, and `gone`.

**Why:** Mobile replay needs a deterministic, non-transport-specific way to resolve an outbox item. Treating expected stale-version or missing-entity cases as ordinary typed outcomes keeps the replay engine simple and lets the app choose repair behavior through refetch.

**Alternatives considered:**
- Structured error metadata on thrown tRPC errors: workable, but it makes expected replay cases feel exceptional and complicates queue control flow.

### 6. Version aggregate roots, not every child row independently

**Decision:** For aggregate-style entities such as recipes, the parent entity version SHALL be the concurrency boundary even when the mutation rewrites ingredients, steps, images, or videos. For row-style entities such as groceries or planned items, the row itself remains the version boundary.

**Why:** Mobile offline edit commands need one stable concurrency token per logical entity. Per-child versioning would make normal recipe edits too expensive and brittle.

**Alternatives considered:**
- Per-table child version checks: rejected because common recipe edits would need many tokens and create excessive false conflicts.

### 7. Allow versioned and idempotent rollout to be selective in v1

**Decision:** This phase SHALL prioritize entities used by the first cheap offline mutation rollout. Collaborative entities such as recipes, groceries, and planned items should use explicit versions; single-user desired-state actions may rely on idempotent set semantics even if no standalone versioned row is exposed yet.

**Why:** The repo has many mutable domains, but mobile offline value arrives fastest by hardening the first replay-safe families rather than boiling the ocean.

## Risks / Trade-offs

- **[Broad contract churn across server and clients]** -> Mitigate by routing adoption through shared hooks and by rolling out replay-safe endpoints family by family.
- **[Version checks create more visible conflicts than last-write-wins]** -> Mitigate with coarse repair via refetch rather than trying to preserve stale local assumptions.
- **[Operation receipt storage grows over time]** -> Mitigate with retention windows or pruning keyed to replay expectations.
- **[Aggregate updates such as recipe edits remain complex]** -> Mitigate by anchoring concurrency at the parent entity version rather than every rewritten child table.

## Migration Plan

1. Add non-null `version` columns with default `1` to the selected mutable entities and backfill existing rows.
2. Surface `version` in read contracts before switching clients to the new mutation families.
3. Introduce replay-safe mutation contracts with structured outcomes and operation receipts.
4. Migrate mobile/shared callers to the replay-safe contracts during the later outbox and cheap-mutation phases.
5. Remove or de-emphasize legacy replay-unsafe mutation entry points once callers no longer depend on them.

## Open Questions

- Which mutation families beyond recipes, groceries, and planned items should join the first versioned rollout versus staying desired-state-only?
- How long should operation receipts be retained before pruning?
- Should duplicate outcomes carry the original resolved version, or is a duplicate marker plus refetch enough for the client?
