import { createRatingsHooks } from '@norish/shared-react/hooks';

import { isBackendUnreachableError } from '@/lib/outbox';
import { useTRPC } from '@/providers/trpc-provider';

const sharedRatingsHooks = createRatingsHooks({
  useTRPC,
  shouldPreserveOptimisticUpdate: isBackendUnreachableError,
});

export const useRatingQuery = sharedRatingsHooks.useRatingQuery;
export const useRatingsMutation = sharedRatingsHooks.useRatingsMutation;
