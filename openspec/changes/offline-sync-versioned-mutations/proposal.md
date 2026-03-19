## Why

Mobile offline writes need more than transport correlation. Norish currently applies most cheap mutations as live, last-write-wins requests, so an outbox would replay blind into stale data, duplicate retries, and replay-unsafe toggle semantics.

## What Changes

- Add entity `version` fields to the mutable records that participate in the first offline-write rollout and expose those versions in query DTOs.
- **BREAKING** Add version-aware mutation inputs and structured stale-version / missing-entity responses for replay-safe edit and delete flows.
- **BREAKING** Replace replay-unsafe toggle semantics with desired-state or set-style mutation contracts where repeated replay must remain safe.
- Add server-side operation receipt handling keyed by `operationId` so duplicate offline replays can resolve deterministically.
- Standardize mutation outcome metadata so mobile can distinguish applied, duplicate-applied, stale-version conflict, and missing-entity outcomes and repair state through invalidation/refetch.

## Capabilities

### New Capabilities
- `offline-write-mutation-contracts`: Versioned optimistic-concurrency contracts and replay-safe mutation outcomes for offline-capable writes.
- `operation-replay-idempotency`: Server-side operation receipt handling that deduplicates repeated offline replays by `operationId`.

### Modified Capabilities
None.

## Impact

- `packages/db` schema, migrations, and repositories for compare-and-swap updates and version increments
- `packages/shared` contracts and zod schemas for surfaced versions and structured replay outcomes
- `packages/trpc` routers and procedure inputs for replay-safe edit/delete/set flows
- Mobile and web clients that consume changed mutation contracts
