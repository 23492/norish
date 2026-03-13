import { useCallback } from 'react';

import { useNetworkStatus } from '@/context/network-context';

/**
 * Returns a guard function that checks whether the app is currently
 * able to perform server mutations.
 */
export function useMutationReachabilityGuard(): () => boolean {
  const { appOnline } = useNetworkStatus();

  return useCallback(() => appOnline, [appOnline]);
}
