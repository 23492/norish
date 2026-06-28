import type { CreateHouseholdHooksOptions } from "./types";
import { createUseHouseholdCache } from "./use-household-cache";
import { createUseHouseholdMutations } from "./use-household-mutations";
import { createUseHouseholdQuery } from "./use-household-query";
import { createUseHouseholdsListQuery } from "./use-households-list-query";
import { createUseHouseholdSubscription } from "./use-household-subscription";

export type {
  CreateHouseholdHooksOptions,
  HouseholdCacheHelpers,
  HouseholdData,
  HouseholdMutationsResult,
  HouseholdQueryResult,
  HouseholdsListResult,
} from "./types";

export { createUseHouseholdQuery } from "./use-household-query";
export { createUseHouseholdsListQuery } from "./use-households-list-query";
export { createUseHouseholdMutations } from "./use-household-mutations";
export { createUseHouseholdCache } from "./use-household-cache";
export {
  createUseHouseholdSubscription,
  type HouseholdSubscriptionToastAdapter,
} from "./use-household-subscription";

type CreateHouseholdHooksFullOptions = CreateHouseholdHooksOptions & {
  useCurrentUserId: () => string | undefined;
  useCurrentUserName: () => string | null;
  useToastAdapter: () => import("./use-household-subscription").HouseholdSubscriptionToastAdapter;
};

export function createHouseholdHooks({
  useTRPC,
  useCurrentUserId,
  useCurrentUserName,
  useToastAdapter,
}: CreateHouseholdHooksFullOptions) {
  const useHouseholdQuery = createUseHouseholdQuery({ useTRPC });
  const useHouseholdsListQuery = createUseHouseholdsListQuery({ useTRPC });
  const useHouseholdCacheHelpers = createUseHouseholdCache({ useTRPC });
  const useHouseholdMutations = createUseHouseholdMutations({
    useTRPC,
    useHouseholdQuery,
    useHouseholdsListQuery,
    useCurrentUserName,
  });
  const useHouseholdSubscription = createUseHouseholdSubscription({
    useTRPC,
    useHouseholdCacheHelpers,
    useCurrentUserId,
    useToastAdapter,
  });

  return {
    useHouseholdQuery,
    useHouseholdsListQuery,
    useHouseholdMutations,
    useHouseholdCacheHelpers,
    useHouseholdSubscription,
  };
}
