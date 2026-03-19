## MODIFIED Requirements

### Requirement: Dependent systems react to app-online transitions
The `NetworkProvider` SHALL track `appOnline` transitions so dependent systems can react when live server work becomes possible or impossible, and replay gating SHALL use backend HTTP reachability rather than websocket status alone.

#### Scenario: App becomes reachable again
- **WHEN** `appOnline` transitions from `false` to `true`
- **THEN** dependent reconnect logic such as cache invalidation, session re-validation, and outbox replay SHALL run

#### Scenario: Backend HTTP is reachable while websocket reconnects
- **WHEN** backend health indicates the configured backend is reachable
- **AND** websocket transport is still disconnected or reconnecting
- **THEN** dependent HTTP replay logic SHALL treat `appOnline` as available for replay-safe mutation work
- **AND** it SHALL NOT wait for websocket open before replaying queued commands

#### Scenario: App loses live reachability
- **WHEN** `appOnline` transitions from `true` to `false`
- **THEN** dependent systems SHALL observe `appOnline === false`
- **AND** live server work and queued replay SHALL pause until reachability is restored
