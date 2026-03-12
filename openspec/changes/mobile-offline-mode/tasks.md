## 1. Migrate AsyncStorage → MMKV

- [ ] 1.1 Install `react-native-mmkv` in `apps/mobile`
- [ ] 1.2 Create `apps/mobile/src/lib/cache/mmkv-storage.ts` — initialize a shared MMKV instance (single instance, id `'norish-storage'`) to be used as the app-wide key-value store
- [ ] 1.3 Migrate `apps/mobile/src/hooks/recipes/recipe-filters-storage-adapter.ts` — replace AsyncStorage calls with synchronous MMKV `.getString()` / `.set()` / `.delete()`
- [ ] 1.4 Migrate `apps/mobile/src/hooks/use-amount-display-preference.ts` — replace the `useAsyncStorageState` helper with a synchronous MMKV-backed version (MMKV reads are sync, so the `useEffect` + loading pattern can be simplified)
- [ ] 1.5 Migrate `apps/mobile/src/stores/timers.ts` — replace AsyncStorage persistence with MMKV
- [ ] 1.6 Migrate `apps/mobile/src/lib/preferences/locale-preference-store.ts` — replace AsyncStorage with MMKV
- [ ] 1.7 Add a one-time migration path for existing AsyncStorage-backed values (recipe filters, amount display preference, timers, locale) so current users do not silently lose local state on upgrade
- [ ] 1.8 Remove `@react-native-async-storage/async-storage` from `apps/mobile/package.json` and run `pnpm install`
- [ ] 1.9 Verify no remaining AsyncStorage imports exist in `apps/mobile/src/` (grep check)
- [ ] 1.10 Test the migrated storage: app preferences, recipe filters, timers, and locale all persist correctly across app restart

## 2. Dependencies & Project Setup (Offline)

- [ ] 2.1 Install `@tanstack/react-query-persist-client` in `apps/mobile`
- [ ] 2.2 Install `@react-native-community/netinfo` in `apps/mobile`
- [ ] 2.3 Verify the new native dependencies work with an EAS dev build (NetInfo requires a native module)

## 3. Network Awareness Layer

- [ ] 3.1 Create `apps/mobile/src/lib/network/network-status.ts` — utility wrapping `NetInfo.addEventListener` to provide reactive connectivity state
- [ ] 3.2 Create `apps/mobile/src/context/network-status-context.tsx` — `NetworkStatusProvider` exposing `isConnected`, `isBackendReachable`, and `connectionType` via React Context
- [ ] 3.3 Integrate `NetworkStatusProvider` into the root `_layout.tsx` provider tree (wrap above `TrpcProvider`)
- [ ] 3.4 Add periodic backend health check (`/api/health`) within `NetworkStatusProvider` to track `isBackendReachable` — only when NetInfo says device is connected
- [ ] 3.5 Create `apps/mobile/src/hooks/use-network-status.ts` convenience hook that allows any component to consume the network context

## 4. Persistent Query Cache (MMKV)

- [ ] 4.1 Create `apps/mobile/src/lib/cache/mmkv-persister.ts` — implement the `Persister` interface from `@tanstack/react-query-persist-client` backed by the shared MMKV instance from task 1.2
- [ ] 4.2 Add a dehydration whitelist / filter so only offline-safe read queries are persisted (recipes list/detail, favorites, and other small authenticated shell reads) instead of blindly persisting every query state
- [ ] 4.3 Integrate `PersistQueryClientProvider` (or `persistQueryClient`) into `TrpcProvider` in `apps/mobile/src/providers/trpc-provider.tsx` — wrapping the existing `QueryClientProvider` with the MMKV persister
- [ ] 4.4 Configure `QueryClient` defaults: set `gcTime` to 7 days and `staleTime` to 5 minutes for recipe-centric queries; set persister `maxAge` to 7 days; avoid `refetchOnMount: "always"` on mobile offline-first surfaces
- [ ] 4.5 Add a cache buster / schema version so incompatible persisted query payloads can be invalidated cleanly on future releases
- [ ] 4.6 Verify hydration works: cold-start the app, navigate to dashboard, kill the app, restart — cached recipes should appear immediately before any network request

## 5. Offline-Tolerant Auth

- [ ] 5.1 Create `apps/mobile/src/lib/auth/cached-session.ts` — utility to read the existing `norish_session_data` from SecureStore and parse it, checking `expiresAt` timestamp
- [ ] 5.2 Modify `apps/mobile/src/context/auth-context.tsx` — in `AuthProviderInner`, catch network errors from `authClient.useSession()` and fall back to the cached session from SecureStore when offline
- [ ] 5.3 Integrate `useNetworkStatus()` hook into `AuthProviderInner` so it knows when the device is offline and can skip server validation
- [ ] 5.4 Add a startup auth/bootstrap gate in `apps/mobile/src/app/_layout.tsx` (or equivalent root auth boundary) so route selection waits for backend URL hydration, persisted query restoration, and offline auth fallback before rendering the login stack
- [ ] 5.5 Add background session re-validation: when `isConnected` transitions from `false` → `true`, trigger a `useSession` refetch in the background; if the server responds 401, redirect to login and clear cached session
- [ ] 5.6 Handle the edge case of an expired `expiresAt` timestamp while offline: still allow read-only access but set a flag (e.g., `sessionExpiredOffline: boolean`) in the auth context for UI to display a warning
- [ ] 5.7 On explicit sign-out, clear the persisted query cache and any user-owned offline recipe/favorites data before returning to the unauthenticated flow

## 6. tRPC / Query Layer Offline Resilience

- [ ] 6.1 Configure React Query's `networkMode` to `'offlineFirst'` so queries attempt to use cached data before making network requests
- [ ] 6.2 Modify `apps/mobile/src/providers/trpc-provider.tsx` — add `retry` logic that respects offline state (disable retries when `isConnected` is false)
- [ ] 6.3 Ensure WebSocket subscription layer handles disconnects gracefully: the existing `createTRPCProviderBundle` should already handle reconnection, but verify no unhandled errors bubble up when the WebSocket is closed due to offline
- [ ] 6.4 Add an `onlineManager` override from TanStack Query that uses the `NetInfo` state, so React Query knows the true connectivity state and pauses/resumes queries accordingly
- [ ] 6.5 Audit mobile/shared-react query hooks that currently opt into their own defaults (`useQuery`, `useInfiniteQuery`, login/provider discovery, user profile, permissions, locale preferences, etc.) and align them with the offline-first strategy where appropriate
- [ ] 6.6 Clear persisted query data when the backend base URL changes, in addition to resetting auth storage, so cached content never bleeds across servers

## 7. Offline Search Fallback

- [ ] 7.1 Update the search experience so that, when offline, it filters already-cached recipes locally by recipe name/title only
- [ ] 7.2 Disable or clearly label advanced search/filter combinations as online-only while offline instead of implying full search parity
- [ ] 7.3 Add offline-specific search empty messaging so users understand they are searching cached recipe names only

## 8. UI: Offline Banner & Mutation Guards

- [ ] 8.1 Create `apps/mobile/src/components/OfflineBanner.tsx` — a persistent top banner that appears when `isConnected` is false or `isBackendReachable` is false, with animated slide-in/out
- [ ] 8.2 Integrate `OfflineBanner` into the root layout (e.g., above `<RootStack />` or inside `AuthGatedProviders`)
- [ ] 8.3 Create `apps/mobile/src/hooks/use-offline-guard.ts` — a hook that returns `{ isOffline, warnOffline }` where `warnOffline()` shows a toast like "This action requires an internet connection"
- [ ] 8.4 Update the Favorites toggle button to use `useOfflineGuard` — dim/disable when offline, show toast on press
- [ ] 8.5 Update the Ratings component to use `useOfflineGuard` — dim/disable star interaction when offline
- [ ] 8.6 Audit `RecipeActionsMenu` and other recipe-detail actions to disable server-dependent operations offline (delete, convert, AI actions, nutrition estimation, edit flows). Leave purely local/share actions enabled when they do not require connectivity

## 9. UI: Empty States & Sync Indicator

- [ ] 9.1 Create `apps/mobile/src/components/OfflineEmptyState.tsx` — a reusable empty state component for screens with no cached data while offline (icon + message + "Connect to load" text)
- [ ] 9.2 Integrate `OfflineEmptyState` into the recipe detail screen — show when navigating to an un-cached recipe while offline
- [ ] 9.3 Integrate `OfflineEmptyState` into the dashboard screen — show when no recipes are cached at all
- [ ] 9.4 Add "Last synced X ago" label to the dashboard header — using the `dataUpdatedAt` timestamp from the React Query cache for the recipes query
- [ ] 9.5 Update the pull-to-refresh behavior — when offline, show a toast instead of attempting a refresh

## 10. Integration Testing & Verification

- [ ] 10.1 Add automated tests for cached-session parsing, expired-session offline fallback, and the root auth/bootstrap gate
- [ ] 10.2 Add automated tests for cache clearing on logout and backend URL change
- [ ] 10.3 Add automated tests for offline title-only search over cached recipes
- [ ] 10.4 Manual test: full offline flow — load app online, view dashboard + a recipe detail, toggle airplane mode, kill app, reopen — verify data is visible
- [ ] 10.5 Manual test: auth flow — verify login screen appears when offline with no cached session; verify cached session allows access when offline without a login flash
- [ ] 10.6 Manual test: reconnection — verify data refreshes, offline banner dismisses, mutations re-enable, and WebSocket reconnects when going back online
- [ ] 10.7 Manual test: expired cache — change device clock forward 8 days, restart app, verify cache is cleared and fresh fetch is triggered
- [ ] 10.8 Verify no regressions: run the existing app end-to-end flow (connect → login → dashboard → recipe detail → favorites) while fully online
