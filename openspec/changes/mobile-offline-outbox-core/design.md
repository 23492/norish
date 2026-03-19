## Context

The mobile app already has several useful primitives: persisted TanStack Query cache, centralized reachability state, a shared operation-id link that preserves caller-provided `operationId`, and realtime envelopes that carry `operationId` and `eventId`. What it does not have is a durable mutation command log. Today the shared tRPC provider simply blocks mutations when live reachability is unavailable.

There is also an important implementation gap between current code and the existing `mobile-network-status` spec: backend reachability in the app is currently driven by websocket open/close callbacks, while offline replay needs HTTP-authoritative reachability because replay success or failure is resolved directly by the mutation response.

## Goals / Non-Goals

**Goals:**
- Introduce a durable mobile outbox for semantic mutation commands.
- Replay queued commands deterministically after backend HTTP reachability is restored.
- Resolve replay success or failure from direct mutation responses rather than websocket events.
- Preserve stored `operationId` and replay metadata across app restarts.
- Support safe command compaction for repeated local edits to the same entity.

**Non-Goals:**
- Build an enterprise-style visible outbox screen.
- Support imports, uploads, temp-ID create flows, or queued background jobs.
- Mirror all server data in a local relational database.
- Depend on websocket reconnect as the sole replay trigger.
- Solve domain-specific optimistic UI for every mutation family in this phase.

## Decisions

### 1. Store semantic commands in a dedicated durable outbox

**Decision:** Mobile SHALL persist semantic commands rather than raw HTTP requests. Each outbox item should include at least the procedure path, typed input payload, `operationId`, entity/coalescing key, version metadata when present, enqueue timestamp, attempt metadata, and current command state.

**Why:** Norish uses typed tRPC mutations, not a stable REST wire format. Semantic commands are compact, durable, and easy to evolve alongside replay-safe mutation contracts.

**Alternatives considered:**
- Raw HTTP request persistence: rejected because it is brittle across auth headers, serializer changes, and FormData payloads.
- Local SQLite mirror first: rejected for v1 because cheap commands do not justify a full local database yet.

### 2. Use a dedicated MMKV-backed outbox store for v1 durability

**Decision:** The first outbox implementation SHALL use a dedicated MMKV store separate from the persisted query cache and preference stores.

**Why:** The repo already uses MMKV successfully for persisted query state and small durable client stores. Cheap offline mutation volume should remain small, and MMKV keeps implementation friction low.

**Alternatives considered:**
- SQLite: stronger relational tooling, but heavier than needed for the initial cheap-command scope.

### 3. Replay commands sequentially in queue order

**Decision:** The replay engine SHALL process one command at a time in persisted queue order after safe compaction rules are applied.

**Why:** Serial replay minimizes cross-command ordering bugs, makes failure handling simpler, and matches the low-volume kitchen/offline use case better than a high-throughput worker model.

**Alternatives considered:**
- Parallel replay: rejected because it makes causality, coalescing, and conflict repair much harder.

### 4. Coalesce only safe same-entity command patterns

**Decision:** The outbox SHALL compact repeated commands only for explicitly safe patterns: edit+edit becomes the latest edit against the original base version, desired-state set+set becomes the latest desired state, and delete supersedes earlier queued edits or sets for the same entity.

**Why:** Compaction reduces unnecessary replay noise and avoids avoidable conflicts, but only when user intent remains equivalent.

**Alternatives considered:**
- No compaction: rejected because repeated local edits would create unnecessary replay traffic and stale conflicts.
- Aggressive semantic merging across unrelated commands: rejected because it risks losing intent.

### 5. Replay success and failure come from direct mutation responses

**Decision:** The replay engine SHALL clear or classify an outbox item from the direct HTTP mutation response. Realtime websocket events remain available for later reconciliation, but the engine does not wait for them to acknowledge a command.

**Why:** The user may regain HTTP reachability before websocket reconnect stabilizes. Direct response resolution keeps replay deterministic and matches the existing preference for direct success/failure handling.

**Alternatives considered:**
- Wait for matching websocket event: rejected because transport timing would incorrectly determine mutation success.

### 6. Replay gating uses backend HTTP reachability, not websocket liveness

**Decision:** Replay SHALL be triggered from backend HTTP reachability and device connectivity. Websocket disconnect alone SHALL NOT block replay if backend health checks still succeed.

**Why:** Replay is HTTP work. The current websocket-based reachability implementation is too strict for replay and conflicts with the existing `mobile-network-status` spec direction.

**Alternatives considered:**
- Keep replay behind websocket reconnect: rejected because websocket reconnect gaps are common and would delay safe replay unnecessarily.

### 7. Keep outbox core separate from domain optimistic projections

**Decision:** This phase SHALL own command durability, hydration, compaction, and replay, but it SHALL NOT define every domain's optimistic cache projection. Domain-specific optimistic UI lands in the later cheap-mutation phase.

**Why:** A durable queue should exist before multiple domains start depending on it. This keeps the foundation testable and lets later phases opt in family by family.

### 8. Replay uses a dedicated execution path that preserves stored `operationId`

**Decision:** The mobile replay executor SHALL send queued commands through a path that preserves the stored `operationId` and bypasses the user-facing mutation guard only for replay work that is already gated by replay reachability.

**Why:** Queued commands must keep their original correlation identity. The current mutation guard is correct for unsupported live offline writes, but replayed commands need a narrowly-scoped escape hatch.

## Risks / Trade-offs

- **[MMKV-backed queue schema may need future migration]** -> Mitigate with an explicit outbox storage version and isolated store namespace.
- **[A bad command can block the queue]** -> Mitigate with retry limits, terminal classification, and aggregate follow-up handling in the reconciliation phase.
- **[Replay starts too early because reachability flaps]** -> Mitigate with backend health probing thresholds and replay debounce.
- **[Compaction can accidentally drop intent]** -> Mitigate by restricting compaction to clearly safe same-entity patterns only.

## Migration Plan

1. Add the durable outbox store and command serializer behind infrastructure that is not yet used by mutation families.
2. Align replay gating with backend HTTP reachability so replay can run independently of websocket reconnect timing.
3. Add the replay executor and state machine, initially with no user-facing mutation families opted in.
4. Enable domain adoption in the later cheap-mutation phase.

## Open Questions

- What storage versioning and migration strategy should the outbox use when command shapes evolve?
- Should replay debounce immediately on the first healthy probe, or wait for a short stability window?
- Do we want a hard cap on queued command count before surfacing a generic sync-health warning?
