import { createRecipeHooks } from '@norish/shared-react/hooks';

import { isBackendUnreachableError } from '@/lib/outbox';
import { useTRPC } from '@/providers/trpc-provider';

const sharedRecipeHooks = createRecipeHooks({
  useTRPC,
  shouldPreserveOptimisticUpdate: isBackendUnreachableError,
});

export const sharedDashboardRecipeHooks = sharedRecipeHooks.dashboard;
export const sharedRecipeFamilyHooks = sharedRecipeHooks.recipe;
