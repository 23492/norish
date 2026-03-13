import { useEffect } from 'react';
import { useIntl } from 'react-intl';

import type { ReachabilityMode, ReachabilityRuntimeState } from '@/lib/network/reachability-store';
import { setMutationMessageResolver } from '@/lib/network/reachability-store';

/**
 * Wires the localized message resolver into the module-level reachability
 * store. Must be called inside a component that has access to `useIntl()`.
 */
export function useMutationMessageResolver(): void {
  const intl = useIntl();

  useEffect(() => {
    setMutationMessageResolver(
      (mode: ReachabilityMode, runtimeState: ReachabilityRuntimeState) => {
        if (runtimeState !== 'ready') {
          return intl.formatMessage({ id: 'common.connection.mutationBlockedInitializing' });
        }

        if (mode === 'backend-unreachable') {
          return intl.formatMessage({ id: 'common.connection.mutationBlockedServerUnreachable' });
        }

        return intl.formatMessage({ id: 'common.connection.mutationBlockedOffline' });
      },
    );

    return () => {
      setMutationMessageResolver(null);
    };
  }, [intl]);
}
