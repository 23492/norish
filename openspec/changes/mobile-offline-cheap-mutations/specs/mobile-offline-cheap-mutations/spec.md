## ADDED Requirements

### Requirement: Supported cheap mobile mutations enqueue and update UI immediately
The mobile app SHALL let supported cheap mutation families enqueue offline commands and apply their optimistic UI state immediately instead of waiting for live server success.

#### Scenario: Delete is queued while offline
- **WHEN** the user performs a supported delete action while the backend cannot be reached live
- **THEN** the affected entity SHALL disappear from the local mobile view immediately
- **AND** a replay-safe delete command SHALL be persisted in the durable outbox

#### Scenario: Edit is queued while offline
- **WHEN** the user performs a supported edit action while the backend cannot be reached live
- **THEN** the edited entity SHALL reflect the new local values immediately in the mobile UI
- **AND** a replay-safe edit command SHALL be persisted in the durable outbox

### Requirement: Supported desired-state actions preserve latest local intent
Supported desired-state mobile actions SHALL represent the caller's latest local intent and SHALL NOT require replaying every superseded intermediate state.

#### Scenario: Desired-state action is queued while offline
- **WHEN** the user performs a supported desired-state action such as setting a favorite state while offline
- **THEN** the local mobile UI SHALL reflect the requested final state immediately
- **AND** the persisted command SHALL preserve the desired final state for later replay

#### Scenario: Multiple queued edits target one entity from one device
- **WHEN** one device queues multiple supported edits for the same entity before replay begins
- **THEN** the mobile UI SHALL continue showing the latest local intent for that entity
- **AND** the outbox SHALL retain only the latest safe replay representation needed for sync

### Requirement: Successful replay preserves the optimistic local result
When a queued cheap mutation later replays successfully, the mobile app SHALL resolve the command without requiring the user to manually re-apply the change.

#### Scenario: Delete queued offline later replays successfully
- **WHEN** a supported delete command is queued offline and later replays with a successful outcome
- **THEN** the queued command SHALL be cleared from the outbox
- **AND** the deleted entity SHALL remain absent from the local view after authoritative reconciliation

### Requirement: Unsupported or expensive actions remain live-only
Mutation families that require temp IDs, uploads, imports, or other long-running workflows SHALL remain live-only and SHALL not be silently queued by this phase.

#### Scenario: Import or upload is attempted while offline
- **WHEN** the user attempts an unsupported import, upload, or other long-running action while live backend access is unavailable
- **THEN** the action SHALL remain blocked by the existing offline mutation guard
- **AND** no outbox command SHALL be created for it
