## Why

Norish mobile already persists query reads and propagates `operationId`, but it still has no durable command log or replay engine. Without a dedicated outbox core, offline writes cannot survive app restarts, reconnect predictably, or resolve replay outcomes without depending on realtime timing.

## What Changes

- Add a durable mobile outbox that stores semantic mutation requests (`path`, typed input, `operationId`, entity metadata, version metadata, retry metadata) instead of raw HTTP requests.
- Add a replay engine that hydrates on app start, replays in deterministic order, and resolves items from direct mutation responses rather than waiting for websocket acknowledgements.
- Add outbox state transitions and compaction rules for repeated local edits to the same entity.
- Modify replay scheduling so it is driven by backend HTTP reachability and not blocked solely by websocket disconnects.
- Keep imports/uploads, temp-ID create flows, and long-running background jobs out of scope for this phase.

## Capabilities

### New Capabilities
- `mobile-mutation-outbox`: Durable storage, hydration, replay, and retry behavior for offline mobile mutation commands.

### Modified Capabilities
- `mobile-network-status`: Replay gating and backend reachability for sync must remain valid even when websocket transport is temporarily disconnected.

## Impact

- `apps/mobile` storage, provider wiring, replay lifecycle, and reachability integration
- `packages/shared-react` tRPC integration for replayed mutations that preserve stored `operationId`
- Mutation transport behavior that currently hard-blocks offline writes
