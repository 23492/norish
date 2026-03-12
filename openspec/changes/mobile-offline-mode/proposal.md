## Why

The mobile app currently requires an active network connection to the backend for *every* interaction — including viewing previously loaded recipes, browsing favorites, and checking meal plans. If the user opens the app on the train, in a basement kitchen, or anywhere with spotty connectivity, they see a blank screen or spinner. This is a poor experience for a cooking app, where users frequently need hands-free access to recipes while actively cooking.

Adding offline-mode support means users can browse their recipe library, read full recipe details, and follow cooking steps even when completely disconnected. Data syncs back transparently when connectivity returns. The web app remains online-only as requested.

## What Changes

- **Migrate AsyncStorage → MMKV**: Replace all existing `@react-native-async-storage/async-storage` usage (recipe filters, amount display preference, timers, locale preference) with `react-native-mmkv` for synchronous, high-performance key-value storage. Remove the AsyncStorage dependency entirely.
- **Local data cache for recipes**: Use MMKV as the persistence backend for TanStack Query (`persistQueryClient`) so recipe data survives app restarts and network loss. Persist only the offline-safe read queries the app actually needs.
- **User-owned offline cache**: Treat cached recipe and favorites data as belonging to the currently authenticated mobile user. Clear the persisted cache on logout and when the configured backend changes so one user never sees another user's offline data.
- **Offline-aware auth session**: Cache the BetterAuth session/token locally so the app does not require a server round-trip to verify the user on every cold start. Gracefully degrade when the session cannot be refreshed.
- **Offline-first data flow**: Wrap the existing tRPC query layer with an offline-aware strategy: serve cached data immediately, attempt background refresh when online, and surface a non-blocking "offline" indicator.
- **Basic offline search**: When offline, the search screen falls back to simple title-only matching against cached recipes instead of full server-backed filtering.
- **Network connectivity awareness**: Add a connectivity monitor (NetInfo) that the UI and data layers observe to toggle between online/offline behaviour.
- **Offline UI indicators**: Show a subtle banner or badge when the app is operating in offline mode, and disable or gracefully degrade write operations (favorites toggle, ratings, etc.) with a queued-action pattern or clear "unavailable offline" messaging.

## Capabilities

### New Capabilities
- `mobile-offline-cache`: Persistent on-device data caching layer for recipes, favorites, and user profile — enabling the app to render content without network access, clear data on logout, and provide basic title-only offline recipe search.
- `mobile-offline-auth`: Offline-tolerant authentication flow that caches session data locally, skips server verification when offline, and re-validates when connectivity returns.
- `mobile-network-awareness`: Connectivity monitoring and offline UI indicators (banners, disabled mutations) that keep the user informed of their connection state.

### Modified Capabilities
- `mobile-trpc-integration`: The tRPC provider and query hooks need to integrate with the offline cache and network-awareness layers, serving stale data when offline instead of erroring.

## Impact

- **`apps/mobile`**: Major changes — new cache layer, network monitor, auth flow adjustments, UI indicators across layout and components.
- **`packages/shared-react`**: Moderate — the shared tRPC provider bundle likely needs mobile-specific query persistence, query dehydration filters, and offline-aware query defaults in addition to `staleTime`/`gcTime` tuning.
- **`packages/auth`**: No server-side changes. Client-side `@better-auth/expo` plugin already stores session in SecureStore — the change is in how the mobile app *uses* that cached session when the server is unreachable.
- **Dependencies**: Additions — `react-native-mmkv`, `@react-native-community/netinfo`, `@tanstack/react-query-persist-client`. Removal — `@react-native-async-storage/async-storage`.
- **Web app**: No changes required.
- **Backend / API**: No changes required.
