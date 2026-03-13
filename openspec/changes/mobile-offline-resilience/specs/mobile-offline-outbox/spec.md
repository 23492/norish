## ADDED Requirements

### Requirement: Outbox persists mutations in MMKV while offline
When `appOnline === false`, the outbox service SHALL serialize and persist eligible mutations to a dedicated MMKV instance (`norish-outbox`) instead of failing fast.

#### Scenario: User deletes a recipe while offline
- **WHEN** the user triggers a recipe deletion while `appOnline === false`
- **THEN** the deletion mutation SHALL be added to the outbox queue with `status: 'pending'`
- **AND** the recipe SHALL be optimistically removed from the local TanStack Query cache
- **AND** the user SHALL see immediate UI feedback that the action was queued

#### Scenario: User attempts an unsupported mutation type while offline
- **WHEN** the user triggers a mutation type not registered with the outbox while `appOnline === false`
- **THEN** the mutation SHALL fail fast with the existing reachability guard behavior

---

### Requirement: Outbox replays mutations sequentially on reconnect
When `appOnline` transitions from `false` to `true`, the outbox service SHALL replay all pending mutations in FIFO order, one at a time.

#### Scenario: Successful replay of queued mutations
- **WHEN** `appOnline` transitions to `true`
- **AND** the outbox contains pending mutations
- **THEN** the outbox service SHALL replay each mutation sequentially via the corresponding tRPC call
- **AND** each successfully replayed mutation SHALL be removed from the outbox
- **AND** related TanStack Query cache keys SHALL be invalidated after each successful replay

#### Scenario: Replay while already replaying
- **WHEN** `appOnline` transitions to `true`
- **AND** a replay is already in progress
- **THEN** a new replay SHALL NOT be started

---

### Requirement: Server-authoritative conflict resolution on replay
When a replayed mutation fails due to a server-side state conflict (entity deleted, version mismatch, or similar), the outbox service SHALL discard the mutation and notify the user.

#### Scenario: Recipe already deleted by another household member
- **WHEN** a queued recipe deletion replays
- **AND** the server returns a 404 (entity not found) or equivalent tRPC error
- **THEN** the mutation SHALL be discarded from the outbox (treated as a no-op)
- **AND** the user SHALL be shown a notification explaining that the recipe was already removed

#### Scenario: Authoritative conflict on a queued mutation
- **WHEN** a queued mutation replays
- **AND** the server returns a 409 or business-logic conflict error
- **THEN** the mutation SHALL be discarded from the outbox
- **AND** the user SHALL be shown a notification describing the conflict

---

### Requirement: Transient replay failures halt the queue
When a replayed mutation fails due to a transient error (network timeout, server 500), the outbox service SHALL stop replay and retry on the next `appOnline` transition.

#### Scenario: Network error during replay
- **WHEN** a queued mutation replays
- **AND** the tRPC call fails with a transient network error or server 500
- **THEN** the mutation SHALL remain in the outbox with its current status
- **AND** all subsequent queued mutations SHALL remain in the outbox
- **AND** replay SHALL resume on the next `appOnline: false → true` transition

---

### Requirement: Outbox exposes status via hook
The outbox service SHALL expose its state via a `useOutboxStatus()` hook that provides `pendingCount`, `isReplaying`, and `lastSyncResult`.

#### Scenario: Querying outbox status while offline with pending mutations
- **WHEN** the outbox contains 3 pending mutations
- **AND** `appOnline === false`
- **THEN** `useOutboxStatus()` SHALL return `{ pendingCount: 3, isReplaying: false, lastSyncResult: null }`

#### Scenario: Querying outbox status during replay
- **WHEN** the outbox is replaying mutations
- **THEN** `useOutboxStatus()` SHALL return `isReplaying: true` and the current `pendingCount`

---

### Requirement: Outbox is cleared on sign-out and backend URL change
The outbox MMKV store SHALL be cleared when the user signs out or when the backend base URL changes, to prevent queued mutations from replaying under a different user or against a different server.

#### Scenario: User signs out with pending mutations
- **WHEN** the user signs out
- **AND** the outbox contains pending mutations
- **THEN** all outbox entries SHALL be cleared from MMKV
- **AND** no notification SHALL be shown for discarded pending mutations

#### Scenario: Backend URL changes with pending mutations
- **WHEN** the backend base URL changes (e.g., user reconfigures server address)
- **AND** the outbox contains pending mutations
- **THEN** all outbox entries SHALL be cleared from MMKV

---

### Requirement: Outbox has a maximum queue size
The outbox SHALL enforce a maximum queue size (e.g., 50 entries) to prevent unbounded growth during extended offline periods.

#### Scenario: Outbox queue is full
- **WHEN** the outbox contains the maximum number of entries
- **AND** the user triggers another outbox-eligible mutation while offline
- **THEN** the mutation SHALL fail fast
- **AND** the user SHALL be shown a message indicating that the offline action queue is full
