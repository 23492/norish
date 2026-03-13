import { useEffect, useRef } from 'react';

import { createClientLogger } from '@norish/shared/lib/logger';

import { useNetworkStatus } from '@/context/network-context';
import { queryCacheStorage } from '@/lib/storage/query-cache-mmkv';
import { persistedQueryClient } from '@/providers/trpc-provider';

const log = createClientLogger('cache-lifecycle');

/**
 * Watches `appOnline` transitions and invalidates all queries when the
 * backend becomes reachable again, so cached data is replaced with fresh data.
 */
export function useCacheInvalidationOnReconnect() {
  const { appOnline } = useNetworkStatus();
  const prevAppOnlineRef = useRef(appOnline);

  useEffect(() => {
    const wasOffline = !prevAppOnlineRef.current;

    prevAppOnlineRef.current = appOnline;

    if (wasOffline && appOnline) {
      log.info('App back online — invalidating all queries');
      persistedQueryClient.invalidateQueries();
    }
  }, [appOnline]);
}

/**
 * Clears both the in-memory QueryClient cache and the persisted MMKV cache.
 * Call this on sign-out so user/household data does not leak across accounts.
 */
export function clearAllQueryCaches() {
  log.info('Clearing all query caches (in-memory + persisted)');
  persistedQueryClient.clear();
  queryCacheStorage.clearAll();
}

/**
 * Clears both the in-memory QueryClient cache and the persisted MMKV cache.
 * Call this when the backend base URL changes so cached data from one
 * environment does not leak into another.
 */
export const clearQueryCachesOnUrlChange = clearAllQueryCaches;
