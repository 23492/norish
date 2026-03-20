## Why

The new version foundation still does not make writes replay-safe on its own. Norish already propagates `operationId`, but several mutation families still depend on implicit toggle or current-state behavior and most callers cannot distinguish applied, duplicate, stale, and missing-entity outcomes without inferring from transport errors.

## What Changes

- **BREAKING** Replace replay-unsafe toggle or flip-style mutation contracts with desired-state or explicit-version inputs in one coordinated migration sweep.
- **BREAKING** Add structured mutation outcomes so clients can distinguish `applied`, `duplicate`, `conflict`, and `gone` without treating expected replay cases as opaque failures.
- Add durable operation receipt handling keyed by mutation family, actor scope, and `operationId` so duplicate replays return the original outcome without re-running side effects.
- Document the current inventory of replay-unsafe mutation families and the migration/removal plan for legacy entry points.

## Capabilities

### New Capabilities
- `offline-write-mutation-contracts`: Replay-safe desired-state and version-aware mutation contracts with structured outcomes for offline-capable writes.
- `operation-replay-idempotency`: Durable operation receipt handling that deduplicates repeated offline replays by `operationId`.

### Modified Capabilities
None.

## Impact

- `packages/shared` mutation schemas, DTOs, and offline/outbox contract types
- `packages/trpc` routers for favorites, groceries, planned items, recipes, and other replay-safe write families
- `packages/db` repositories plus new receipt persistence for replay deduplication
- Web, mobile, and shared React mutation hooks, optimistic cache logic, and replay handling
