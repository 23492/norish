## 1. Offline Auth Bypass — Session Snapshot

> **Cross-change note (`offline-auth-bypass`):** The `offline-auth-bypass` change already implements SecureStore-based offline session reading in `AuthProviderInner` via `readPersistedSession()`. This section's MMKV session snapshot is intended to **supersede** that approach by providing a richer, version-busted session cache. When implementing this section:
> - Replace the `readPersistedSession()` SecureStore path in `AuthProviderInner` with `loadSessionSnapshot()` from MMKV.
> - Remove the `readPersistedSession()` helper from `auth-storage.ts` (or keep it only for migration).
> - Ensure a single source of truth for offline session data (MMKV snapshot, not both SecureStore and MMKV).

- [ ] 1.1 Create `apps/mobile/src/lib/auth/session-snapshot.ts` — MMKV-backed store for the last-known session (user object + timestamp), with `saveSessionSnapshot`, `loadSessionSnapshot`, `clearSessionSnapshot`, and version-busting logic (discard if app version differs)
- [ ] 1.2 Update `AuthProviderInner` in `apps/mobile/src/context/auth-context.tsx` to persist a session snapshot on every successful `useSession()` resolution (i.e., whenever `session?.user` is truthy)
- [ ] 1.3 Update `AuthProviderInner` to load the cached session snapshot on mount and use it as the initial `isAuthenticated: true` / `user` value when `appOnline === false` and `useSession()` is still pending or failed
- [ ] 1.4 Clear the session snapshot on sign-out (add to existing `signOut` callback in `AuthProviderInner`)
- [ ] 1.5 Clear the session snapshot on backend URL change (add to the existing cache-clearing logic in `use-cache-lifecycle.ts`)

## 2. Outbox Storage & Service

- [ ] 2.1 Create a dedicated MMKV instance for the outbox at `apps/mobile/src/lib/storage/outbox-mmkv.ts` (id: `norish-outbox`)
- [ ] 2.2 Create `apps/mobile/src/lib/outbox/outbox-store.ts` — MMKV-backed storage for outbox entries with types (`OutboxEntry`: `id`, `type`, `payload`, `createdAt`, `status`, `retryCount`), and functions: `addEntry`, `removeEntry`, `getEntries`, `clearAll`, `getEntryCount`, MAX_QUEUE_SIZE constant
- [ ] 2.3 Create `apps/mobile/src/lib/outbox/outbox-types.ts` — type definitions for mutation handlers: `OutboxMutationHandler<T>` interface with `type`, `replay(payload: T, trpc)`, and `isConflictError(error)` methods
- [ ] 2.4 Create `apps/mobile/src/lib/outbox/outbox-replay.ts` — the core replay loop: reads pending entries, replays sequentially via registered handlers, discards on conflict, stops on transient error, returns a `SyncResult` summary
- [ ] 2.5 Create `apps/mobile/src/lib/outbox/handlers/recipe-delete.ts` — the first outbox handler for `recipe.delete` mutations, implementing `OutboxMutationHandler` with conflict detection for 404/NOT_FOUND responses

## 3. Outbox React Integration

- [ ] 3.1 Create `apps/mobile/src/context/outbox-context.tsx` — `OutboxProvider` and `useOutboxStatus()` hook exposing `pendingCount`, `isReplaying`, `lastSyncResult`, and an `enqueue(type, payload)` function
- [ ] 3.2 Create `apps/mobile/src/hooks/use-outbox-replay.ts` — hook that listens for `appOnline: false → true` transitions and triggers the outbox replay loop, updating context state during/after replay
- [ ] 3.3 Mount `OutboxProvider` inside `AuthenticatedProviders` in the root `_layout.tsx` (inside both `UserProvider` and `MobileIntlProvider`, so outbox can access tRPC and show i18n toasts)
- [ ] 3.4 Clear the outbox MMKV store on sign-out (add to existing `clearAllQueryCaches` or equivalent), and on backend URL change

## 4. Wire Recipe Deletion to Outbox

- [ ] 4.1 Create `apps/mobile/src/hooks/use-offline-recipe-delete.ts` — a wrapper around the existing recipe delete mutation that checks `appOnline`: if online, calls the tRPC mutation directly; if offline, enqueues to the outbox and optimistically removes the recipe from the TanStack Query cache
- [ ] 4.2 Update recipe deletion call sites (recipe detail actions menu, any swipe-to-delete) to use `useOfflineRecipeDelete` instead of the direct tRPC mutation
- [ ] 4.3 Verify that optimistic cache removal restores correctly if the outbox entry is later discarded on conflict (i.e., the recipe reappears in the list after cache invalidation on reconnect)

## 5. Outbox UI — Banner & Toasts

- [ ] 5.1 Update `apps/mobile/src/components/shell/offline-banner.tsx` to read `useOutboxStatus()` and display pending mutation count when offline (e.g., "Offline · 3 changes pending sync")
- [ ] 5.2 Add sync result feedback: on replay completion, show a toast for success ("All changes synced"), partial conflict ("Some changes couldn't sync"), or transient failure (no toast, keep pending count visible)
- [ ] 5.3 Add i18n keys for outbox-related strings across all 8 supported locales: pending count banner text, sync success/conflict/failure toast text, queue-full message

## 6. Testing

- [ ] 6.1 Write unit tests for `session-snapshot.ts` (save/load/clear round-trip, version-busting, invalid data handling)
- [ ] 6.2 Write unit tests for `outbox-store.ts` (add/remove/get/clear entries, MAX_QUEUE_SIZE enforcement)
- [ ] 6.3 Write unit tests for `outbox-replay.ts` (sequential replay, conflict discard, transient halt, empty queue)
- [ ] 6.4 Write unit tests for `recipe-delete` handler (success replay, 404 conflict detection, transient error passthrough)
- [ ] 6.5 Write unit tests for `useOutboxStatus` / `OutboxProvider` (pending count updates, replaying state, lastSyncResult)
- [ ] 6.6 Manual verification: boot app offline with cached session → confirm authenticated app shell renders with cached data
- [ ] 6.7 Manual verification: delete recipe offline → confirm optimistic removal + outbox indicator → restore connection → confirm replay and server-side deletion
- [ ] 6.8 Manual verification: delete recipe offline, another user deletes same recipe → restore connection → confirm conflict toast and no error state
