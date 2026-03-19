## ADDED Requirements

### Requirement: Conflict repair restores authoritative server state
When replay reveals that optimistic local state no longer matches the server, the mobile app SHALL restore authoritative state through targeted invalidation or refetch.

#### Scenario: Offline delete conflicts with newer server version
- **WHEN** a delete command queued offline replays and the server reports a version conflict because the entity changed elsewhere
- **THEN** the mobile app SHALL invalidate or refetch the affected authoritative queries
- **AND** the resulting local view SHALL restore the server's current state for that entity

#### Scenario: Offline edit targets an entity deleted elsewhere
- **WHEN** an edit command queued offline replays and the server reports that the entity is gone
- **THEN** the mobile app SHALL invalidate or refetch the affected authoritative queries
- **AND** the resulting local view SHALL remove the missing entity from the optimistic client state

### Requirement: Realtime envelopes assist reconciliation without acknowledging replay
The mobile app SHALL use realtime envelope metadata for reconciliation support and dedupe, but direct replay responses SHALL remain the source of command acknowledgement.

#### Scenario: Websocket disconnects and reconnects during replay
- **WHEN** websocket transport disconnects and later reconnects while replay is occurring
- **THEN** commands already resolved by direct replay responses SHALL remain resolved
- **AND** later websocket events SHALL be used only for reconciliation or dedupe, not to re-acknowledge those commands

#### Scenario: Duplicate reconciliation event arrives after reconnect
- **WHEN** the client receives a later realtime event whose `eventId` or `operationId` matches work it has already reconciled
- **THEN** the client SHALL avoid applying duplicate reconciliation work for that event

### Requirement: Duplicate replay of the same operation resolves cleanly
If replay retries a command whose `operationId` has already been applied on the server, the mobile client SHALL treat the duplicate outcome as a resolved command rather than a user-visible failure.

#### Scenario: Replay retries an already-applied operation
- **WHEN** replay receives a duplicate outcome for a queued command's `operationId`
- **THEN** the client SHALL clear that queued command from active replay
- **AND** it MAY invalidate the affected authoritative queries to confirm final server state without showing per-item failure UI
