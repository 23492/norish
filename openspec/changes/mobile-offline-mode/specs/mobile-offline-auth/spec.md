## ADDED Requirements

### Requirement: Cached session allows offline access
The mobile app SHALL use locally-cached BetterAuth session data to authenticate the user when the backend is unreachable, allowing read-only access to cached content.

#### Scenario: Cold start with valid cached session and no network
- **WHEN** the app starts without network connectivity
- **AND** a valid session cookie and session data exist in SecureStore
- **THEN** the app SHALL treat the user as authenticated
- **AND** SHALL render the authenticated app shell with cached data
- **AND** SHALL NOT redirect to the login screen
- **AND** SHALL NOT briefly render the login screen during auth bootstrap

#### Scenario: Cold start with no cached session and no network
- **WHEN** the app starts without network connectivity
- **AND** no session data exists in SecureStore
- **THEN** the app SHALL show the login/connection setup screen
- **AND** SHALL display a message that a network connection is required to sign in

#### Scenario: Cold start after explicit logout
- **WHEN** the user previously signed out (clearing session data)
- **AND** the app starts without network connectivity
- **THEN** the app SHALL NOT bypass the login screen
- **AND** SHALL require network connectivity to re-authenticate

---

### Requirement: Background session re-validation on reconnect
The mobile app SHALL silently re-validate the cached session with the backend when network connectivity is restored.

#### Scenario: Session is still valid on reconnect
- **WHEN** network connectivity is restored
- **AND** the app re-validates the cached session with the backend
- **AND** the backend confirms the session is valid
- **THEN** the app SHALL continue operating normally with no user-visible interruption

#### Scenario: Session is revoked on reconnect
- **WHEN** network connectivity is restored
- **AND** the app re-validates the cached session with the backend
- **AND** the backend indicates the session is invalid or revoked
- **THEN** the app SHALL redirect the user to the login screen
- **AND** SHALL clear the cached session data

---

### Requirement: Offline indicator for expired session
The mobile app SHALL show an informational indicator when operating offline with a session whose `expiresAt` timestamp has passed, while still allowing read-only access.

#### Scenario: Offline with expired session timestamp
- **WHEN** the device is offline
- **AND** the cached session's `expiresAt` timestamp is in the past
- **THEN** the app SHALL still grant read-only access to cached data
- **AND** SHALL show an indicator that the session needs to be refreshed when online

---

### Requirement: Sign-out clears offline-owned data
The mobile app SHALL clear cached session data and persisted offline query data when the user explicitly signs out so the next user cannot see prior offline content.

#### Scenario: Explicit logout clears session and offline cache
- **WHEN** the authenticated user explicitly signs out
- **THEN** the app SHALL clear BetterAuth session data from secure storage
- **AND** SHALL clear the persisted offline query cache before showing the unauthenticated flow
