## MODIFIED Requirements

### Requirement: Mobile startup requires backend URL setup when missing
The mobile app SHALL check for a persisted backend base URL at startup and SHALL route users to a connection setup screen when no URL is present. When operating offline with a previously-configured backend URL, the app SHALL proceed to the authenticated app shell using cached data instead of blocking on a health check.

#### Scenario: First launch with no saved URL
- **WHEN** the app starts and no backend base URL exists in secure storage
- **THEN** the app SHALL show the backend connection setup screen before app tabs

#### Scenario: Launch with saved URL and network available
- **WHEN** the app starts and a backend base URL exists in secure storage
- **AND** the network is available
- **THEN** the app SHALL skip the connection setup screen and route directly into app tabs

#### Scenario: Launch with saved URL and no network
- **WHEN** the app starts and a backend base URL exists in secure storage
- **AND** the network is not available
- **THEN** the app SHALL skip the connection setup screen
- **AND** SHALL route into the authenticated app shell using cached session and data
- **AND** SHALL display an offline indicator
- **AND** SHALL wait for offline auth bootstrap before rendering unauthenticated screens

---

### Requirement: Connection setup validates backend health before saving
The connection setup flow SHALL verify backend reachability using `GET /api/health` and SHALL only save the base URL on successful health response.

#### Scenario: Successful health check
- **WHEN** the user enters a valid base URL and taps connect
- **THEN** the app SHALL call `<baseUrl>/api/health`
- **AND** on success, persist the normalized base URL in secure storage
- **AND** navigate into app tabs

#### Scenario: Failed health check
- **WHEN** the health request fails or returns non-success
- **THEN** the app SHALL show an error state
- **AND** SHALL NOT persist the entered URL

#### Scenario: Health check while offline
- **WHEN** the user is on the connection setup screen and has no network
- **THEN** the connect button SHALL be disabled or show a message that connectivity is required for initial setup

## ADDED Requirements

### Requirement: tRPC provider tolerates offline state
The mobile tRPC provider SHALL not crash or show a fatal error when network requests fail due to offline state. It SHALL allow the React Query cache to serve stale data.

#### Scenario: tRPC query while offline with cached data
- **WHEN** a tRPC query is executed while the device is offline
- **AND** cached data exists in the persisted React Query cache
- **THEN** the query SHALL resolve with the cached data
- **AND** SHALL NOT throw an unhandled error or show an error boundary

#### Scenario: tRPC query while offline without cached data
- **WHEN** a tRPC query is executed while the device is offline
- **AND** no cached data exists
- **THEN** the query SHALL be in an error/paused state
- **AND** the UI SHALL show the graceful "not available offline" empty state

#### Scenario: tRPC mutation while offline
- **WHEN** a tRPC mutation is attempted while the device is offline
- **THEN** the mutation SHALL fail gracefully
- **AND** the UI SHALL inform the user that the action requires connectivity

---

### Requirement: WebSocket subscription resilience
The tRPC WebSocket subscription layer SHALL handle offline/reconnect cycles gracefully without crashing the app.

#### Scenario: WebSocket disconnects due to offline
- **WHEN** the device loses connectivity
- **THEN** the WebSocket connection SHALL close without triggering an app-level error
- **AND** the subscription layer SHALL enter a reconnecting state

#### Scenario: WebSocket reconnects when online
- **WHEN** network connectivity is restored
- **THEN** the WebSocket subscription layer SHALL automatically reconnect
- **AND** SHALL resume real-time updates
