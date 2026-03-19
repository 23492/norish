## ADDED Requirements

### Requirement: Replay-safe mutable entities expose a version token
The system SHALL expose a monotonically increasing integer `version` for each mutable entity that participates in replay-safe offline writes.

#### Scenario: Reading a replay-safe entity
- **WHEN** a client fetches a replay-safe mutable entity
- **THEN** the returned DTO SHALL include the entity's current `version`
- **AND** that value SHALL be suitable for later use as `expectedVersion` in a replay-safe mutation

#### Scenario: Creating a replay-safe entity
- **WHEN** the system creates a new entity in a versioned replay-safe family
- **THEN** the stored entity version SHALL start at `1`

### Requirement: Replay-safe edit and delete mutations enforce expected version
Replay-safe edit and delete mutations SHALL compare the caller's `expectedVersion` with the stored entity version before applying authoritative state changes.

#### Scenario: Expected version matches
- **WHEN** a replay-safe mutation is submitted with an `expectedVersion` equal to the stored entity version
- **THEN** the mutation SHALL apply once
- **AND** the entity version SHALL increment before the successful outcome is returned

#### Scenario: Expected version is stale
- **WHEN** a replay-safe mutation is submitted with an `expectedVersion` that does not match the stored entity version
- **THEN** the mutation SHALL NOT apply the requested change
- **AND** it SHALL return a conflict outcome that indicates the entity is stale

#### Scenario: Target entity no longer exists
- **WHEN** a replay-safe mutation is submitted for an entity that has already been deleted or is otherwise missing
- **THEN** the mutation SHALL NOT recreate or partially apply the change
- **AND** it SHALL return a gone outcome suitable for client repair by refetch

### Requirement: Replay-safe toggle families use desired-state semantics
Replay-safe mutation families whose live API would otherwise toggle current state SHALL accept the caller's desired final state instead of inferring a flip from current server state.

#### Scenario: Client replays a desired-state mutation twice
- **WHEN** the same desired-state replay-safe mutation is submitted more than once
- **THEN** the resulting authoritative state SHALL remain equal to the caller's requested desired state
- **AND** the repeated submission SHALL NOT invert the state a second time

#### Scenario: Desired state already matches server state
- **WHEN** a replay-safe desired-state mutation targets an entity that is already in the requested final state
- **THEN** the mutation SHALL resolve without introducing an opposite-state transition

### Requirement: Replay-safe mutation outcomes are direct-resolution friendly
Replay-safe mutation responses SHALL use a structured outcome that lets clients resolve queued commands without inferring meaning from transport errors.

#### Scenario: Mutation applies successfully
- **WHEN** a replay-safe mutation changes authoritative state
- **THEN** the response SHALL indicate an applied outcome
- **AND** it SHALL include enough metadata for the client to treat the queued command as resolved

#### Scenario: Mutation detects stale or missing state
- **WHEN** a replay-safe mutation returns a conflict or gone outcome
- **THEN** the response SHALL identify that outcome explicitly
- **AND** the client SHALL be able to choose targeted invalidation or refetch without guessing whether the request reached the server
