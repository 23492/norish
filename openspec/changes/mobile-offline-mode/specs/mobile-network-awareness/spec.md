## ADDED Requirements

### Requirement: Network connectivity monitoring
The mobile app SHALL continuously monitor device network connectivity using NetInfo and expose the current state via a React Context provider.

#### Scenario: Device goes offline
- **WHEN** the device loses network connectivity
- **THEN** the `NetworkStatusProvider` SHALL update `isConnected` to `false`
- **AND** all consumers of the context SHALL receive the updated value

#### Scenario: Device comes back online
- **WHEN** the device regains network connectivity
- **THEN** the `NetworkStatusProvider` SHALL update `isConnected` to `true`
- **AND** all consumers of the context SHALL receive the updated value

---

### Requirement: Backend reachability monitoring
The mobile app SHALL periodically check backend reachability (via the `/api/health` endpoint) when the device has network connectivity, and expose this state through the `NetworkStatusProvider`.

#### Scenario: Backend is reachable
- **WHEN** the device has network connectivity
- **AND** the health endpoint responds successfully
- **THEN** `isBackendReachable` SHALL be `true`

#### Scenario: Backend is unreachable despite network
- **WHEN** the device has network connectivity
- **AND** the health endpoint does not respond or returns an error
- **THEN** `isBackendReachable` SHALL be `false`

---

### Requirement: Offline mode banner
The mobile app SHALL display a persistent, non-intrusive banner or indicator when operating in offline mode, informing the user that some features are unavailable.

#### Scenario: Offline banner appears
- **WHEN** the device is offline or the backend is unreachable
- **THEN** the app SHALL display a visible banner indicating offline status
- **AND** the banner SHALL NOT block the user from interacting with cached content

#### Scenario: Offline banner dismisses when online
- **WHEN** the device regains connectivity and the backend is reachable
- **THEN** the offline banner SHALL be dismissed automatically

---

### Requirement: Mutation controls disabled when offline
The mobile app SHALL disable or visually dim mutation-triggering and other server-dependent UI elements (e.g., favorite toggle, rating stars, recipe edit/delete, measurement conversion, AI actions) when operating offline.

#### Scenario: Favorite button when offline
- **WHEN** the user is viewing a recipe while offline
- **THEN** the favorite toggle button SHALL be visually dimmed or disabled
- **AND** tapping it SHALL show a brief message that this action requires connectivity

#### Scenario: Mutation buttons when online
- **WHEN** the device is online and the backend is reachable
- **THEN** all mutation-triggering UI elements SHALL be fully enabled and functional

#### Scenario: Recipe actions menu when offline
- **WHEN** the user opens recipe actions while offline
- **THEN** server-dependent actions such as delete, convert measurements, and AI-triggered operations SHALL be disabled or visibly unavailable
- **AND** actions that do not require connectivity may remain enabled

---

### Requirement: Last synced timestamp
The mobile app SHALL display a "Last synced" timestamp on key screens so the user understands the freshness of the data they are viewing.

#### Scenario: Showing last sync time
- **WHEN** the user is viewing cached data (online or offline)
- **THEN** the app SHALL display the timestamp of the most recent successful data fetch
- **AND** the timestamp SHALL update after each successful background refetch
