## Why

The mobile offline foundation (shipped in `mobile-offline-foundation`) established three-state reachability, cache persistence, session re-validation, and an offline indicator. However, two critical gaps remain: the app cannot boot past the login screen when offline (even with a valid cached auth cookie), and all mutations are fail-fast — users cannot make any changes while disconnected. For a recipe app used in kitchens with unreliable WiFi, both gaps undermine the offline experience. Users should be able to open the app, browse cached recipes, and perform common actions (like deleting a recipe) offline, with those actions syncing reliably when connectivity resumes.

## What Changes

- **Offline auth bypass**: When the app boots offline with a persisted auth session (Better Auth cookie in `expo-secure-store`), trust the cached session and render the authenticated app immediately instead of blocking at the login screen. Session re-validation on reconnect (already implemented) handles the case where the cookie has expired server-side — sign-out occurs once the backend authoritatively rejects the session.
- **Mutation outbox queue**: Introduce a persistent mutation queue (outbox) backed by MMKV. When `appOnline === false`, queued mutation types (starting with recipe deletion) are saved locally instead of failing. When `appOnline` transitions to `true`, the outbox replays queued mutations in order against the backend.
- **Conflict resolution strategy**: Define a "last write wins with server authority" policy. If an outbox mutation fails because the target entity was already modified or deleted on the server (e.g. user B deleted the recipe while user A was offline), the failed mutation is discarded and the user is notified. The server response is always authoritative — no client-side merge logic.
- **Outbox status indicator**: A small pending-changes indicator in the UI (e.g. badge or banner) that shows the user how many queued mutations are waiting to sync, with feedback on success/failure after replay.

## Capabilities

### New Capabilities
- `mobile-offline-outbox`: Persistent MMKV-backed mutation queue with replay-on-reconnect, conflict resolution (server-authoritative, discard-on-conflict), and status tracking for pending/failed mutations.

### Modified Capabilities
- `mobile-offline-auth`: Extend the auth flow to trust cached session cookies on offline cold boot, rendering the authenticated app without waiting for server validation. Logout on revalidation failure (already exists) covers expired sessions.
- `mobile-offline-indicator`: Add outbox status (pending mutation count, sync failures) to the existing offline banner/indicator system.

## Impact

- **`apps/mobile`** — New outbox service + MMKV store, outbox replay hook, updates to auth context for offline session trust, UI indicator for pending mutations.
- **`apps/mobile` auth context** — `AuthProviderInner` needs to treat a cached session as valid when offline, rather than remaining in a loading/unauthenticated state that blocks the login screen.
- **`apps/mobile` mutation flows** — Recipe deletion (initial scope) wrapped with outbox queue logic instead of the current fail-fast guard.
- **No backend changes** — All conflict resolution is handled by inspecting server error responses during replay. The server's existing error responses (404, 409, etc.) are sufficient.
- **Dependencies** — No new dependencies expected. MMKV is already available for outbox persistence.
