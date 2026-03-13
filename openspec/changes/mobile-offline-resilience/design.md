## Context

The `mobile-offline-foundation` change shipped a three-state reachability model (`offline | backend-unreachable | online`), MMKV-backed TanStack Query cache persistence, session re-validation on reconnect, an offline indicator banner, and a fail-fast mutation reachability guard. The foundation explicitly scoped out offline writes ("Offline writes / mutation queue — no persisted or deferred create/update/delete replay") as a non-goal.

Two gaps remain:

1. **Offline cold boot blocks at login.** `AuthProviderInner` calls Better Auth's `useSession()`, which internally fires a `GET /api/auth/get-session` request. When the app boots offline, that request either hangs or fails, leaving `isPending: true` or `isAuthenticated: false` — the user sees the unauthenticated login screen even though a valid session cookie is persisted in `expo-secure-store`. The session re-validation hook (`useSessionRevalidation`) already handles "revalidate on reconnect and sign out if expired," but nothing currently allows the auth context to trust the cached session before the server responds.

2. **All mutations are fail-fast.** The `useMutationReachabilityGuard()` hook blocks all mutations when `appOnline === false`. Common household actions — deleting a recipe, toggling a favorite, editing a grocery list — are entirely unavailable offline. Users in kitchens with intermittent WiFi lose the ability to do anything until full backend connectivity is restored.

## Goals / Non-Goals

**Goals:**

1. **Offline auth bypass** — When the app cold-boots offline with a persisted auth cookie, render the authenticated app immediately using cached session data. Session re-validation on reconnect (already implemented) covers expiry/revocation.
2. **Persistent mutation outbox** — Introduce a queue that captures specific mutation types while offline, persists them in MMKV, and replays them in order when `appOnline` transitions to `true`.
3. **Server-authoritative conflict resolution** — When replayed mutations fail due to server-side state changes (entity deleted, version mismatch), discard the failed mutation and notify the user. No client-side merge logic.
4. **Outbox status visibility** — Surface pending mutation count and sync outcomes in the UI so the user has confidence that queued actions will be synced.
5. **Incremental mutation scope** — Start with recipe deletion as the first outbox-capable mutation. The outbox architecture should support adding more mutation types (favorite toggle, rating, grocery edits) later.

**Non-Goals:**

- Full offline-first architecture with client-side conflict merging or CRDTs.
- Offline creation of new recipes or complex multi-step mutations.
- Backend changes — conflict detection uses existing server error responses.
- Offline image uploads or media mutations.
- Real-time sync between multiple offline household members — only replay-on-reconnect, not multi-device conflict negotiation.

## Decisions

### 1. Trust cached session data on offline cold boot

**Decision**: When `authClient.useSession()` is pending and the device is offline (`appOnline === false`), the `AuthProviderInner` SHALL attempt to read the last-known session from a locally-cached session snapshot (persisted to MMKV on every successful session fetch). If a cached snapshot exists, treat `isAuthenticated: true` and provide the cached user object. When the backend becomes reachable, the existing `useSessionRevalidation` hook re-checks the session and signs out if it's expired.

**Why not just wait for `useSession()` to resolve?** Because Better Auth's Expo client fires a network request for session validation. When offline, this either hangs (leaving `isPending: true` forever) or fails (leaving `isAuthenticated: false`). Neither state allows the user to see cached recipes.

**Why a separate MMKV snapshot instead of trusting `expo-secure-store` directly?** The secure store holds the raw auth cookie, not parsed session data (user object, expiry). Extracting and validating JWT claims from `expo-secure-store` at the client side would couple us to cookie internals. A simple MMKV snapshot of the last-known session response is cleaner and compatible with how Better Auth manages sessions.

**Alternatives considered**:
- *Intercept `useSession()` at the network layer*: Too fragile — tightly coupled to Better Auth internals.
- *Always show cached app without auth*: Would allow access to household data without any auth gate, which is worse for data privacy.

### 2. Outbox persistence uses a dedicated MMKV instance

**Decision**: Create a new MMKV instance (`id: 'norish-outbox'`) to store the mutation queue. Each queued mutation is stored as a serialized entry with: `id`, `type` (mutation name), `payload` (mutation input), `createdAt`, `status` (`pending | replaying | failed`), and `retryCount`.

**Why a separate MMKV instance?** Same reasoning as the query cache — the outbox has its own lifecycle (cleared on sign-out and backend URL change, but not on normal cache invalidation). Separate instances avoid key collisions and simplify bulk clearing.

**Why MMKV and not SQLite?** The outbox is a small ordered list of pending operations. MMKV's synchronous read/write is simpler and faster for this use case. SQLite would add complexity without benefit since we don't need indexes, queries, or relational joins on the queue.

### 3. Outbox replay is sequential and server-authoritative

**Decision**: When `appOnline` transitions from `false` to `true`, replay queued mutations one at a time in FIFO order. For each mutation:

1. Call the corresponding tRPC mutation.
2. **On success**: remove from queue, invalidate related TanStack Query cache keys, show success feedback.
3. **On conflict/gone (server 404, 409, or equivalent tRPC error)**: discard from queue, show a user-facing notification that the action could not be completed (e.g., "Recipe was already deleted by another household member").
4. **On transient failure (network error, 500)**: keep in queue, stop replay, retry on next `appOnline` transition.

**Why sequential and not parallel?** Mutations may have ordering dependencies (e.g., removing from grocery list then deleting the recipe). Sequential replay preserves intent ordering. The outbox will be small (handful of mutations at most) so parallelism offers no meaningful performance gain.

**Why discard on conflict instead of asking the user?** A recipe deletion that fails because the recipe was already deleted is a no-op. A recipe deletion that fails because someone edited it is a genuine conflict, but asking the user to resolve it retroactively (possibly hours later) creates a confusing UX. Server-authoritative discard with a notification is the simplest model that maintains data integrity.

**Alternatives considered**:
- *Client-side merge with user prompts*: Too complex for v1, and most mutations (deletes, toggles) aren't meaningfully mergeable.
- *Automatic retry with exponential backoff*: Appropriate for transient failures (included), but not for authoritative conflicts (those should be discarded).

### 4. Mutation-specific outbox handlers, not a generic interceptor

**Decision**: Each outbox-capable mutation gets an explicit handler that defines how to serialize, replay, and handle conflicts for that specific mutation type. A central `OutboxService` manages the queue and replay loop, but individual mutation types register themselves with type-safe serialization.

**Why not intercept all mutations generically?** Different mutations have different conflict semantics (a delete on a non-existent entity is a no-op; an edit on a deleted entity is a conflict). Generic interception couldn't handle these distinctions without complex per-mutation configuration that would amount to the same code as explicit handlers.

**Initial handler scope**: `recipe.delete` only. The handler pattern should make adding `favorites.toggle`, `ratings.set`, and `groceries.toggleItem` straightforward in follow-up changes.

### 5. Outbox status exposed via a React context/hook

**Decision**: Expose outbox state via a `useOutboxStatus()` hook that provides `pendingCount`, `isReplaying`, and `lastSyncResult` (success/partial-failure/failure with details). The existing offline banner can incorporate pending count when offline, and a brief toast or snackbar can surface sync results on reconnect.

**Why a hook and not just the banner?** Different parts of the UI may want to react to outbox state differently — the banner shows count while offline, but the dashboard might show a "syncing..." spinner during replay. A hook is more composable than hardcoding into the banner.

### 6. Outbox and auth session cache both clear on sign-out and backend URL change

**Decision**: On sign-out, clear the MMKV outbox store and the cached session snapshot. On backend URL change, clear both as well. This mirrors the existing query cache clearing behavior from the foundation.

**Why?** Queued mutations from user A must never replay under user B's session. Mutations queued against backend A must never replay against backend B. The same privacy/isolation boundary that applies to the query cache applies here.

## Risks / Trade-offs

- **Stale session trust window** → On offline cold boot, the cached session could be expired server-side. **Mitigation**: The trust window is bounded by the `useSessionRevalidation` hook, which signs out as soon as `appOnline` restores and the server rejects the session. The worst case is the user browses cached (read-only) data with an expired cookie until reconnect.
- **Outbox mutations against changed server state** → User deletes a recipe offline, but another household member has already renamed/edited it. **Mitigation**: Server-authoritative discard with user notification. The server's existing 404/409 responses are sufficient signals.
- **Outbox replay ordering assumptions** → If the user queues a sequence of mutations with implicit dependencies (e.g., remove from meal plan, then delete recipe), replay failure on an early item could make later items invalid. **Mitigation**: Sequential replay with stop-on-transient-failure. Conflict-discarded items don't block the queue (they're removed), but transient failures halt replay to preserve ordering for retry.
- **Unbounded outbox growth** → If the user stays offline for a long time and queues many mutations. **Mitigation**: Cap the outbox at a reasonable maximum (e.g., 50 entries). Beyond that, new mutations fail-fast with a message that the queue is full.
- **Cached session data shape drift** → The MMKV session snapshot could become stale if the `User` type changes across app updates. **Mitigation**: version-bust the snapshot (key includes app version or schema version). On mismatch, discard snapshot and fall back to unauthenticated state.

## Open Questions

1. **Which mutation types should follow recipe deletion into the outbox?** Candidates: favorite toggle, rating set, grocery item toggle, grocery item add. Should we commit to a second batch in this change, or plan them as a follow-up?
2. **Should outbox replay happen automatically or require user confirmation?** Automatic is simpler but the user might want to review/cancel queued actions after a long offline period.
3. **Toast vs. banner for sync results?** When mutations replay on reconnect, should success/failure feedback use a toast (ephemeral), a persistent banner section, or a dedicated sync-results screen?
