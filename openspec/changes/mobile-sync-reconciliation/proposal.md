## Why

Once offline writes can queue and replay, Norish still needs a calm way to recover from conflicts and uncertain reconnect timing. Without an explicit reconciliation phase, sync failures will either be invisible or degrade into noisy per-item error UX that does not fit the product.

## What Changes

- Add aggregate sync status and a shell-level banner for pending sync problems and replay failures.
- Define reconciliation rules that restore authoritative server state through targeted invalidation/refetch after conflict or missing-entity outcomes.
- Use realtime envelope metadata (`operationId`, `eventId`) for reconciliation and dedupe support, but not as the sole acknowledgement path.
- Standardize conflict handling for stale delete, stale edit, duplicate replay, and websocket reconnect gaps without adding detailed enterprise-style outbox UI.
- Keep the product surface intentionally coarse: one global sync signal instead of per-command toast or inbox patterns.

## Capabilities

### New Capabilities
- `mobile-sync-status`: Aggregate sync state and global banner behavior for pending or failed offline writes.
- `mobile-sync-reconciliation`: Authoritative repair and conflict-recovery behavior for replayed mobile mutations.

### Modified Capabilities
None.

## Impact

- `apps/mobile` authenticated shell, banner UX, and subscription-driven reconciliation hooks
- Outbox state classification and retry/conflict handling from earlier phases
- Query invalidation and refetch behavior used to restore authoritative server truth after replay issues
