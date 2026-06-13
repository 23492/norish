import type { CreateHouseholdHooksOptions, HouseholdsListResult } from "./types";

import { useQuery, useQueryClient } from "@tanstack/react-query";


export function createUseHouseholdsListQuery({ useTRPC }: CreateHouseholdHooksOptions) {
  return function useHouseholdsListQuery(): HouseholdsListResult {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const queryKey = trpc.households.list.queryKey();

    const { data, isLoading } = useQuery(trpc.households.list.queryOptions());

    const households = data?.households ?? [];
    const activeHouseholdId = data?.activeHouseholdId ?? null;
    const currentUserId = data?.currentUserId;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey });
    };

    return {
      households,
      activeHouseholdId,
      currentUserId,
      isLoading,
      queryKey,
      invalidate,
    };
  };
}
