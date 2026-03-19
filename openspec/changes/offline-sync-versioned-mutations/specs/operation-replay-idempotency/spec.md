## ADDED Requirements

### Requirement: Replay-safe mutations persist operation receipts
The system SHALL persist an operation receipt for each replay-safe mutation execution keyed by the mutation family, actor scope, and `operationId`.

#### Scenario: First execution of a replay-safe mutation
- **WHEN** a replay-safe mutation is processed with a previously unseen `operationId`
- **THEN** the system SHALL execute the mutation normally
- **AND** it SHALL persist a receipt describing the resolved outcome before responding

### Requirement: Duplicate replays reuse the stored outcome
If a replay-safe mutation is retried with an `operationId` that already has a stored receipt for the same mutation family and actor scope, the system SHALL return the stored outcome without reapplying business logic.

#### Scenario: Duplicate replay after a successful apply
- **WHEN** the server receives a second copy of a replay-safe mutation whose prior receipt recorded an applied outcome
- **THEN** the server SHALL NOT apply the mutation a second time
- **AND** it SHALL return a duplicate outcome that resolves the client command successfully

#### Scenario: Duplicate replay after a prior conflict
- **WHEN** the server receives a second copy of a replay-safe mutation whose prior receipt recorded a conflict or gone outcome
- **THEN** the server SHALL return that same stored outcome
- **AND** it SHALL NOT recompute the business mutation as a fresh write

### Requirement: Operation ID collisions are rejected when semantics differ
The system SHALL reject re-use of the same `operationId` when the later request does not match the mutation family and actor scope of the stored receipt.

#### Scenario: Same operationId used for a different mutation family
- **WHEN** a request reuses an `operationId` that is already bound to a different replay-safe mutation family or actor scope
- **THEN** the system SHALL reject the request as an invalid collision
- **AND** it SHALL NOT treat the request as a valid duplicate replay
