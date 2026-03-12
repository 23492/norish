## ADDED Requirements

### Requirement: Persistent query cache via MMKV
The mobile app SHALL persist the TanStack React Query cache to disk using MMKV so that previously-fetched data is available immediately on app start, including when offline.

#### Scenario: Cache hydration on cold start
- **WHEN** the mobile app starts
- **THEN** the persisted query cache SHALL be restored from MMKV into the React Query client before the first screen renders
- **AND** any previously-cached recipe data SHALL be available for rendering

#### Scenario: Cache persistence after successful fetch
- **WHEN** a tRPC query successfully fetches recipe data from the backend
- **THEN** the query result SHALL be persisted to MMKV storage automatically by the persist layer

#### Scenario: Stale data served when offline
- **WHEN** the device has no network connectivity and the user navigates to a screen
- **THEN** the app SHALL serve the most recently cached data for that query
- **AND** SHALL NOT show an error screen or empty state if cached data exists

#### Scenario: Cache expiry
- **WHEN** cached data is older than 7 days
- **THEN** the persister SHALL treat the cache as expired
- **AND** the app SHALL clear the stale cache and require a network fetch on next launch

---

### Requirement: Persisted offline cache is user-owned
The mobile app SHALL treat persisted offline recipe data as belonging to the currently authenticated user and SHALL clear it when ownership changes.

#### Scenario: Sign-out clears persisted offline cache
- **WHEN** the authenticated user explicitly signs out
- **THEN** the app SHALL clear the persisted offline recipe and favorites cache before returning to the unauthenticated flow

#### Scenario: Backend changes clear persisted offline cache
- **WHEN** the configured backend base URL changes
- **THEN** the app SHALL clear the persisted offline cache before using the new backend configuration

---

### Requirement: Query timing configuration for offline tolerance
The mobile app SHALL configure TanStack Query with extended `staleTime` and `gcTime` values for recipe-related queries so that cached data is retained long enough for meaningful offline use.

#### Scenario: Recipe queries retain data in memory
- **WHEN** recipe data has been fetched
- **THEN** the React Query `gcTime` for recipe queries SHALL be at least 7 days
- **AND** the `staleTime` SHALL be at least 5 minutes

#### Scenario: Background refetch when online
- **WHEN** the device has network connectivity and cached data is stale
- **THEN** the query client SHALL attempt a background refetch automatically
- **AND** the UI SHALL update seamlessly with fresh data

---

### Requirement: Basic offline search over cached recipe titles
The mobile app SHALL support simple local search over cached recipe names while offline, without promising full parity with online server-backed search.

#### Scenario: Offline title search with cached recipes
- **WHEN** the device is offline
- **AND** cached recipes exist on the device
- **AND** the user enters search text
- **THEN** the app SHALL filter cached recipes using case-insensitive recipe-name matching
- **AND** SHALL NOT require a network request to show results

#### Scenario: Advanced search controls while offline
- **WHEN** the device is offline
- **THEN** advanced server-backed search/filter behavior SHALL be disabled or clearly marked as requiring connectivity
- **AND** the UI SHALL communicate that offline search is limited to cached recipe names

---

### Requirement: Graceful fallback for uncached screens
The mobile app SHALL show a meaningful empty state when the user navigates to a screen that has no cached data while offline, rather than a generic error.

#### Scenario: No cached data available offline
- **WHEN** the user navigates to a recipe detail page that has never been fetched
- **AND** the device is offline
- **THEN** the app SHALL display a clear message indicating the content is not available offline
- **AND** SHALL NOT show a crash, spinner, or generic error
