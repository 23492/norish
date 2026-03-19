## ADDED Requirements

### Requirement: Mobile stores durable semantic mutation commands
The mobile app SHALL persist offline-capable mutation commands in a durable outbox using semantic command data rather than raw HTTP requests.

#### Scenario: Queuing a command while backend work is unavailable
- **WHEN** an offline-capable mutation is enqueued while live backend work cannot proceed
- **THEN** the outbox SHALL persist the mutation path, typed input, `operationId`, and replay metadata needed to retry later

#### Scenario: App restarts before replay
- **WHEN** the app is terminated or restarted before queued commands replay
- **THEN** the durable outbox SHALL rehydrate the pending commands on next startup
- **AND** their original `operationId` values SHALL be preserved

### Requirement: Outbox replay is sequential and response-driven
The mobile app SHALL replay durable outbox commands sequentially and resolve each command from its direct mutation response.

#### Scenario: Replay succeeds after backend reachability returns
- **WHEN** backend HTTP reachability is restored and the replay engine processes the next queued command
- **THEN** the command SHALL be sent once using its stored semantic payload
- **AND** a successful direct mutation response SHALL remove the command from the active outbox

#### Scenario: Websocket is disconnected during replay
- **WHEN** backend HTTP replay succeeds but websocket transport is still disconnected or reconnecting
- **THEN** the command SHALL still be treated as resolved from the direct mutation response
- **AND** websocket reconnection SHALL NOT be required to clear the command

### Requirement: Outbox commands track explicit replay state
Each durable outbox command SHALL expose an explicit replay state suitable for retry, terminal classification, and later aggregate UI.

#### Scenario: Retryable transport failure during replay
- **WHEN** replay fails because backend transport is still unavailable or another retryable error occurs
- **THEN** the command SHALL remain in the outbox with updated attempt metadata
- **AND** it SHALL be eligible for a later replay attempt

#### Scenario: Terminal replay outcome is returned
- **WHEN** replay resolves with a non-retryable conflict or gone outcome
- **THEN** the command SHALL transition out of ordinary queued replay flow
- **AND** the later reconciliation layer SHALL be able to surface aggregate sync follow-up without replaying it indefinitely

### Requirement: Safe same-entity command compaction is supported
The outbox SHALL compact repeated local commands only when doing so preserves user intent for the same entity.

#### Scenario: Multiple queued edits target the same entity
- **WHEN** one device queues multiple replay-safe edits for the same entity before any replay occurs
- **THEN** the outbox SHALL preserve the latest local intent for that entity
- **AND** it SHALL NOT replay every superseded intermediate edit if a safe compaction rule exists

#### Scenario: Delete supersedes earlier queued edits
- **WHEN** a queued delete targets an entity that already has queued replay-safe edits or desired-state commands from the same device
- **THEN** the outbox SHALL let the delete supersede the earlier local commands for that entity
