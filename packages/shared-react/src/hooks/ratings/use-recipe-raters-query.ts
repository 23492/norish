import type { CreateRatingsHooksOptions } from "./types";

import { useQuery } from "@tanstack/react-query";

/**
 * RATE-01: the per-recipe "rated by <name> ★★★★" list + the aggregate, for an
 * AUTHENTICATED viewer. The query (ratings.getRaters) is access-gated server-side
 * (assertRecipeAccess view), so a user who cannot view the recipe gets FORBIDDEN
 * and no rater data — the UI just renders nothing in that case.
 */
export function createUseRecipeRatersQuery({ useTRPC }: CreateRatingsHooksOptions) {
  return function useRecipeRatersQuery(recipeId: string) {
    const trpc = useTRPC();

    const ratersQuery = useQuery(trpc.ratings.getRaters.queryOptions({ recipeId }));

    return {
      averageRating: ratersQuery.data?.averageRating ?? null,
      ratingCount: ratersQuery.data?.ratingCount ?? 0,
      raters: ratersQuery.data?.raters ?? [],
      isLoading: ratersQuery.isLoading,
    };
  };
}
