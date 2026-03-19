## ADDED Requirements

### Requirement: Terminal sync issues surface through one global banner
The mobile app SHALL surface terminal offline-write sync issues through a single shell-level banner instead of per-command error UI.

#### Scenario: One or more replayed commands cannot be preserved
- **WHEN** one or more replayed offline-write commands resolve with a terminal attention-needed outcome such as conflict or gone
- **THEN** the authenticated mobile shell SHALL display a global sync banner with coarse messaging that some changes could not sync

#### Scenario: Sync issues are cleared
- **WHEN** the terminal sync issues have been cleared by later repair or successful retry handling
- **THEN** the global sync banner SHALL be hidden

### Requirement: Healthy queued activity stays quiet
The mobile app SHALL avoid noisy per-item sync surfaces during normal queued or replaying offline-write activity.

#### Scenario: Commands are only pending or replaying
- **WHEN** offline-write commands are queued or replaying without any terminal attention-needed outcome
- **THEN** the app SHALL NOT show per-command toasts, lists, or a dedicated sync-failure banner for those commands

#### Scenario: Several commands fail at once
- **WHEN** multiple queued commands reach terminal attention-needed outcomes in the same period
- **THEN** the app SHALL still use one aggregate sync banner instead of separate failure surfaces for each command
