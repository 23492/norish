## Context

The Norish mobile app is a pure online client today. Every screen — from the recipe dashboard to recipe detail — fetches data via tRPC HTTP/WebSocket calls to a self-hosted backend. Authentication is handled by BetterAuth's `@better-auth/expo` plugin which stores session cookies in `expo-secure-store`, but the `useSession()` hook makes a server round-trip on every cold start to validate the session. If either the network or the backend is unreachable, the user sees nothing.

This design document covers how to add offline-mode support **exclusively to the mobile app** while leaving the web app, backend, and shared-react package largely untouched.

## Goals / Non-Goals

**Goals:**
- Users can open the mobile app and browse previously-loaded recipes and favorites without a network connection.
- Recipe detail pages (ingredients, steps, nutrition) are readable offline.
- The app clearly communicates when it is operating offline and which features are unavailable.
- When connectivity returns, data silently refreshes in the background.
- The auth gate does not block the user from viewing cached content when the server is unreachable.

**Non-Goals:**
- Offline **writes** (creating recipes, toggling favorites, submitting ratings) are out of scope for V1. Mutations will be disabled/greyed with an "offline" tooltip. Queued-writes may be explored in a future iteration.
- Offline image/media caching is not in scope. Recipe images may not render offline; a graceful placeholder will be shown.
- The web app is explicitly excluded — it will continue to require a live connection.
- Full "local-first" CRDTs or conflict resolution — this is offline-read, online-write.
- Offline support for admin/settings/import screens — only frequently-used recipe-browsing screens.
- Calendar, groceries, and other not-yet-built mobile surfaces are out of scope for V1.

## Decisions

### 1. Consolidate onto MMKV — remove AsyncStorage

**Decision**: Replace all existing `@react-native-async-storage/async-storage` usage with `react-native-mmkv` as the first step, before building the offline cache.

**Rationale**: The app currently uses AsyncStorage in 4 places (recipe filter persistence, amount display preference, timer state, locale preference). Since MMKV is being added anyway for the query cache persister, consolidating eliminates a dependency and brings immediate benefits:
- **Synchronous reads** — MMKV's `.getString()` is synchronous, which simplifies several hooks that currently need `useEffect` + loading state patterns to work around AsyncStorage's async API.
- **10,000x faster** — MMKV uses memory-mapped files vs AsyncStorage's SQLite bridge.
- **One fewer native dep** — `@react-native-async-storage/async-storage` can be removed entirely.

**Migration scope**: 4 files, all simple key-value read/write patterns — straightforward 1:1 replacement.

### 2. Persistence strategy: TanStack Query `persistQueryClient` + MMKV

**Decision**: Use `@tanstack/react-query-persist-client` with `react-native-mmkv` as the storage backend to persist the React Query cache to disk.

**Rationale**: The app already uses TanStack Query (via tRPC). Persisting the query cache means every query the user has already fetched is automatically available offline with zero changes to individual hooks. MMKV is synchronous and extremely fast on iOS/Android (10,000x faster than AsyncStorage), which avoids UI jank on hydration.

**Alternatives considered**:
- *Legend State* (per the referenced article): Would mean introducing an entirely new state management layer alongside TanStack Query. The Legend State approach is ideal for greenfield apps, but for Norish where 20+ hooks already use TanStack Query via tRPC, migrating would be a significant rewrite with no incremental benefit.
- *AsyncStorage*: Slower, asynchronous, and has a 6MB default limit on Android. Not suitable for persisting a full recipe cache.
- *SQLite (via expo-sqlite)*: More powerful but overkill for key-value cache persistence. May be considered in a future "local-first" phase.
- *WatermelonDB / Legend State sync*: Full local-first database — too heavyweight for read-only offline.

**Persistence scope**:
- Persist only offline-safe read queries that improve startup and recipe browsing (recipe lists, recipe detail, favorites, user/profile data needed to render the authenticated shell, and other small read models the mobile shell depends on).
- Do not rely on persisted transient bootstrap state such as auth-provider discovery errors or other short-lived failure states.

### 3. Cache ownership: persisted data belongs to the current signed-in user

**Decision**: Treat the persisted offline cache as user-owned state. On explicit logout, clear the persisted query cache before the app returns to the login screen. Also clear it when the configured backend URL changes.

**Rationale**: The mobile app is a household product, which makes cross-user leakage especially risky. A simple "clear on logout / clear on backend switch" rule avoids showing one user's recipes, favorites, or profile-derived data to the next user on the device without introducing extra complexity into the first version.

**Trade-off**: This means users lose their offline library immediately when they sign out, but that is the correct behavior for privacy and household separation.

### 4. Offline auth: Cached session with background re-validation

**Decision**: When the app cold-starts and the server is unreachable, use the locally-cached session data from SecureStore to assume the user is authenticated. Show a transient "Offline" indicator. When connectivity returns, re-validate the session in the background.

**Rationale**: BetterAuth's `@better-auth/expo` plugin already persists session cookies and session data in SecureStore (keys: `norish_cookie`, `norish_session_data`). The current `useSession()` hook performs a network call to validate. We need to intercept this: if the call fails due to network error (not auth error), fall back to the cached session data and proceed.

**Startup guardrail**: The root app shell must wait for backend URL hydration, auth bootstrap, and persisted query restoration before choosing the authenticated vs unauthenticated stack. Otherwise the app may briefly flash the login screen on cold start before the offline fallback resolves.

**Key guardrails**:
- If the cached session has expired (based on `expiresAt` timestamp), still show a "session may be expired" warning but allow read access to cached data.
- If the user explicitly logged out (no cached session), do not bypass — show the login screen.
- When connectivity returns, silently re-validate. If the server says the session is invalid, redirect to login.

### 5. Network awareness: `@react-native-community/netinfo` + React Context

**Decision**: Use NetInfo to monitor connectivity and expose it via a `NetworkStatusProvider` context that any component or hook can consume.

**Rationale**: NetInfo is the de-facto standard for React Native connectivity monitoring, already used by thousands of Expo apps. A context wrapper keeps the API clean and avoids prop-drilling.

The context will provide:
- `isConnected: boolean` — device has network connectivity
- `isBackendReachable: boolean` — backend health endpoint responds (periodic check)
- `connectionType: string` — wifi / cellular / none

### 6. Query hydration strategy: Stale-while-revalidate

**Decision**: Configure TanStack Query with generous `staleTime` and `gcTime` values for recipe data, and use `persistQueryClient` to restore the cache from MMKV on app start.

**Rationale**: This gives us the "offline-first read" pattern with minimal code changes:
1. App opens → MMKV cache is hydrated into React Query synchronously
2. User sees cached data immediately (even if stale)
3. If online, background refetch happens automatically
4. If offline, stale data is shown with an "offline" indicator

**Implementation note**: The current shared tRPC provider defaults (`gcTime` 10 minutes, `refetchOnMount: "always"`) are too aggressive for this use case. Mobile needs its own offline-friendly defaults or a shared extension point.

**Specific tuning**:
- `staleTime: 5 * 60_000` (5 min) — recipes don't change frequently
- `gcTime: 7 * 24 * 60 * 60_000` (7 days) — keep cached data for a week
- `maxAge` for persister: 7 days — disc cache expires after a week

### 7. Offline search strategy: simple local title matching

**Decision**: Offline search is intentionally limited to local, case-insensitive matching against cached recipe names. Advanced server-backed filters and full search parity are out of scope for V1.

**Rationale**: The current search flow is built around server queries and filter combinations. Reproducing full search behavior locally would quietly expand V1 into a local indexing project. Title-only search gives users a practical way to find already-cached recipes offline without overpromising parity.

**UI expectation**: When offline, the search screen should clearly communicate that it is searching cached recipe names only.

### 8. UI degradation strategy

**Decision**: Mutations and other server-dependent actions (favorites, ratings, recipe edits, delete, measurement conversion, AI actions) will be disabled when offline. The app will show a persistent banner at the top of the screen when in offline mode, and action buttons will appear dimmed with an "Available when online" tooltip/press message.

**Rationale**: Implementing offline write queues with conflict resolution is complex and error-prone. For a cooking app, read-only offline access covers the main use case (reading recipes while cooking). V1 focuses on this high-impact, lower-complexity path.

## Risks / Trade-offs

- **Stale data** → Users might see outdated recipes if another household member edited them while they were offline. Mitigation: Show "Last synced X ago" timestamp; auto-refresh when back online.
- **Cache size** → A large recipe library with rich nutrition data could grow the MMKV cache. Mitigation: Monitor cache size; implement LRU eviction if needed; exclude large blobs (images are already URLs, not cached).
- **Session expiry edge case** → A cached session may be revoked server-side while the user is offline. Mitigation: On reconnection, the app re-validates the session and forces re-login if revoked. Offline access is read-only, so no damage from a revoked session.
- **MMKV native dependency** → Adds a native dependency that requires a dev build (no Expo Go). Mitigation: The app already uses other native modules (expo-secure-store, expo-notifications), so this is acceptable.
- **Partial data** → If a user has only ever viewed the dashboard (list), they won't have recipe detail data cached for offline. Mitigation: Document this behaviour; consider background prefetching of recently-viewed recipe details in a follow-up.
- **Logout clears offline data** → Users who sign out lose their offline recipe library until they sign back in and reconnect. Mitigation: Make this explicit in the UX; prioritize privacy over convenience for V1.

## Open Questions

1. **Should we prefetch recipe details in the background?** Currently, only queries the user has actually navigated to will be cached. We could prefetch the top N recipes' full details for a richer offline experience, at the cost of more bandwidth and storage.
2. **Should we cache recipe images to disk?** `expo-image` (if used) has built-in disk caching. We could configure aggressive image caching for offline image display in a subsequent iteration.
