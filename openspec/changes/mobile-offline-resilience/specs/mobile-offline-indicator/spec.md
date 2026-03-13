## ADDED Requirements

### Requirement: Offline banner shows pending outbox mutation count
When the app is offline and the outbox contains pending mutations, the offline banner SHALL display the number of queued changes awaiting sync.

#### Scenario: Offline with queued mutations
- **WHEN** the app is in a settled non-online mode
- **AND** the outbox contains 3 pending mutations
- **THEN** the offline banner SHALL include text indicating "3 changes pending sync" (or locale-equivalent)

#### Scenario: Offline with no queued mutations
- **WHEN** the app is in a settled non-online mode
- **AND** the outbox is empty
- **THEN** the offline banner SHALL show the standard offline/backend-unreachable message without pending-count text

---

### Requirement: Sync result feedback is shown on reconnect
When the outbox replays mutations on reconnect, the UI SHALL show feedback for the sync outcome via a toast or snackbar.

#### Scenario: All mutations replayed successfully
- **WHEN** `appOnline` transitions to `true`
- **AND** all queued mutations replay successfully
- **THEN** a brief success toast SHALL be shown (e.g., "All changes synced")

#### Scenario: Some mutations failed due to conflicts
- **WHEN** `appOnline` transitions to `true`
- **AND** one or more queued mutations are discarded due to server conflicts
- **THEN** a warning toast SHALL be shown indicating which actions could not be completed

#### Scenario: Replay halted by transient error
- **WHEN** the outbox replay stops due to a transient error
- **THEN** the pending-count indicator SHALL remain visible
- **AND** no success toast SHALL be shown

---

### Requirement: Outbox-related banner and toast text is internationalized
All outbox-related UI text (pending count in banner, sync result toasts) SHALL use the app's i18n system.

#### Scenario: Outbox UI text in non-English locale
- **WHEN** the user's locale is a supported non-English language
- **AND** the outbox banner or sync toast is displayed
- **THEN** all text SHALL appear in the user's configured language
