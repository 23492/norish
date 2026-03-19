## Context

By the time this phase begins, the mobile app will have a durable outbox and at least a first allowlist of optimistic offline cheap mutations. That creates a new product problem: replay failures and stale-state conflicts must be visible enough to restore trust, but not so visible that the app feels like an enterprise queue console.

The repo already has most of the transport-level ingredients for calm reconciliation. Realtime envelopes carry `operationId` and `eventId`, direct mutation replay can resolve success or failure without waiting for websocket timing, and query invalidation is already an accepted way to restore authoritative state. The missing piece is a coherent user-facing and client-behavior model.

## Goals / Non-Goals

**Goals:**
- Surface replay problems through one coarse, global sync signal.
- Restore authoritative server state after conflicts or missing-entity outcomes through targeted invalidation/refetch.
- Use realtime envelope metadata for reconciliation and dedupe without depending on websocket delivery for acknowledgement.
- Resolve duplicate replay and websocket reconnect edge cases without noisy per-item UX.

**Non-Goals:**
- Build a visible outbox inbox, per-command activity feed, or merge workflow.
- Show detailed per-item error toasts for normal replay failures.
- Turn websocket event order into the source of truth for business versioning.
- Replace authoritative server refetch with client-side conflict merges.

## Decisions

### 1. Only terminal sync issues get a dedicated banner

**Decision:** The mobile shell SHALL show a dedicated sync banner only when replay has produced terminal attention-needed issues such as conflict or gone outcomes. Ordinary queued or replaying commands remain quiet, with the existing reachability banner covering offline context.

**Why:** This preserves a balanced local-first feel. Users should not see a new warning banner for every healthy offline command.

**Alternatives considered:**
- Show pending queue count or banner for every offline write: rejected as too noisy.
- Keep failures completely silent: rejected because users need a coarse trust signal when the app has repaired away optimistic state.

### 2. Reconciliation repairs state through invalidate/refetch, not local merge UI

**Decision:** Conflict and gone outcomes SHALL trigger targeted invalidation/refetch of the affected query scopes so the server's latest authoritative state replaces the stale optimistic view.

**Why:** The user explicitly prefers server-authoritative repair over detailed per-action conflict UX. TanStack Query invalidation already exists throughout the app.

**Alternatives considered:**
- Preserve stale optimistic state and ask the user to choose: rejected as too heavy for cheap mutation flows.

### 3. Aggregate sync state is derived separately from active replay queue state

**Decision:** Active queued commands and terminal sync issues SHALL be treated as separate concepts. The replay queue manages pending work; the sync-status layer manages whether the user needs to know that some optimistic changes could not be preserved.

**Why:** A conflict should not keep the active queue permanently blocked, and the user-facing banner should not need a fully visible command ledger.

### 4. Realtime envelopes assist reconciliation and dedupe, not acknowledgement

**Decision:** `operationId` and `eventId` from realtime envelopes SHALL be used to match later events to replayed commands, suppress duplicate reconciliation work, and smooth websocket reconnect gaps. They SHALL NOT be required before a direct replay response can resolve a command.

**Why:** This matches the existing transport model and avoids coupling command success to websocket timing.

### 5. Duplicate replay is treated as resolved success plus optional confirmation refetch

**Decision:** When replay receives a duplicate outcome for an already-processed `operationId`, the mobile client SHALL clear the queued command as resolved and MAY invalidate targeted queries to confirm final authoritative state.

**Why:** Duplicate replay means the original intent already reached the server. The client should not surface it as a user-visible error.

### 6. Websocket reconnect during replay should not cause double resolution

**Decision:** If websocket transport disconnects and reconnects while replay is in flight, direct mutation outcomes SHALL remain the primary command-resolution source. Realtime reconciliation SHALL dedupe later matching events by `eventId` and `operationId`.

**Why:** This keeps replay deterministic while still using realtime signals to reconcile eventual state.

## Risks / Trade-offs

- **[Banner is too subtle and users miss repaired-away changes]** -> Mitigate with clear copy and persistent display until the issue summary is cleared.
- **[Banner is too noisy if too many situations count as failure]** -> Mitigate by limiting it to terminal attention-needed cases only.
- **[Refetch-based repair can cause bursts of network work]** -> Mitigate with targeted invalidation instead of blanket full-app refreshes.
- **[Event dedupe cache can drift or grow]** -> Mitigate with bounded retention for processed event IDs.

## Migration Plan

1. Add aggregate sync-issue classification on top of terminal outbox outcomes.
2. Introduce the shell-level sync banner with coarse copy and i18n support.
3. Update subscription-driven reconciliation to inspect envelope metadata and dedupe post-reconnect events.
4. Validate replay conflict repair flows before broadening the offline mutation allowlist.

## Open Questions

- Should the sync banner offer a single `Refresh` action, or remain informational only?
- How long should aggregate sync issues remain visible after a successful repair refetch?
- Which query scopes need the most precise targeted invalidation to avoid over-refetching on conflict repair?
