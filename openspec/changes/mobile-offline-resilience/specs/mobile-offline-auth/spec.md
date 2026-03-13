## ADDED Requirements

### Requirement: Offline cold boot trusts cached session data
When the app boots while offline and a cached session snapshot exists in MMKV, the auth context SHALL treat the user as authenticated using the cached session data, without waiting for `getSession()` to resolve.

#### Scenario: Cold boot while offline with cached session
- **WHEN** the app boots with `appOnline === false`
- **AND** a valid session snapshot exists in MMKV
- **THEN** `useAuth()` SHALL return `isAuthenticated: true` and the cached `user` object
- **AND** the authenticated app shell SHALL render immediately with cached TanStack Query data

#### Scenario: Cold boot while offline without cached session
- **WHEN** the app boots with `appOnline === false`
- **AND** no session snapshot exists in MMKV
- **THEN** `useAuth()` SHALL return `isAuthenticated: false`
- **AND** the login screen SHALL be shown

---

### Requirement: Session snapshot is persisted on every successful session fetch
After each successful `getSession()` response, the auth context SHALL persist a session snapshot (user object and timestamp) to MMKV so it is available for offline cold boots.

#### Scenario: Successful session fetch updates snapshot
- **WHEN** `authClient.useSession()` resolves with a valid session
- **THEN** the session snapshot in MMKV SHALL be updated with the latest user data and timestamp

---

### Requirement: Session snapshot is cleared on sign-out and backend URL change
The cached session snapshot in MMKV SHALL be cleared when the user signs out or when the backend base URL changes.

#### Scenario: Sign-out clears session snapshot
- **WHEN** the user signs out
- **THEN** the MMKV session snapshot SHALL be deleted
- **AND** subsequent offline cold boots SHALL not find a cached session

#### Scenario: Backend URL change clears session snapshot
- **WHEN** the backend base URL changes
- **THEN** the MMKV session snapshot SHALL be deleted

---

### Requirement: Session snapshot is version-busted on app update
The session snapshot SHALL include a version identifier. If the stored snapshot's version does not match the current app version, the snapshot SHALL be discarded on boot.

#### Scenario: App updated since last session snapshot
- **WHEN** the app boots with a session snapshot in MMKV
- **AND** the snapshot version does not match the current app version
- **THEN** the snapshot SHALL be discarded
- **AND** the auth context SHALL fall back to waiting for `getSession()` or treating the user as unauthenticated if offline
