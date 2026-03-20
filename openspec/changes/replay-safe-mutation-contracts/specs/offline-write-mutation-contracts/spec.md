## ADDED Requirements

### Requirement: Replay-safe write contracts avoid implicit state flips
The system SHALL expose replay-safe mutation inputs that use explicit desired state or `expectedVersion`; it SHALL NOT require callers to infer a blind toggle from current server state.

#### Scenario: Desired-state relationship mutation
- **WHEN** a client wants to set a boolean or membership-style state such as recipe favorite membership
- **THEN** the mutation input SHALL carry the desired final state explicitly
- **AND** replaying the same command SHALL preserve that final state instead of inverting it

#### Scenario: Version-aware shared-entity mutation
- **WHEN** a client edits or deletes a shared mutable entity whose current version matters
- **THEN** the mutation input SHALL carry `expectedVersion`
- **AND** the server SHALL refuse to apply the change when the stored version differs

### Requirement: Replay-safe mutation outcomes are structured
Replay-safe mutation responses SHALL use a structured outcome that lets callers resolve writes without inferring meaning from transport errors.

#### Scenario: Mutation applies successfully
- **WHEN** a replay-safe mutation changes authoritative state
- **THEN** the response SHALL indicate an `applied` outcome
- **AND** it SHALL include enough metadata for the caller to resolve the command successfully

#### Scenario: Mutation detects stale or missing state
- **WHEN** a replay-safe mutation cannot apply because the target version is stale or the entity is missing
- **THEN** the response SHALL return an explicit `conflict` or `gone` outcome

### Requirement: Replay-safe side effects execute at most once per operation
Mutation families with derived side effects SHALL ensure those side effects execute at most once for a given semantic operation.

#### Scenario: Retrying recurring grocery completion
- **WHEN** the same recurring grocery completion command is replayed after a prior successful apply
- **THEN** the grocery state SHALL remain at the caller's requested desired state
- **AND** the recurring schedule SHALL NOT advance a second time
