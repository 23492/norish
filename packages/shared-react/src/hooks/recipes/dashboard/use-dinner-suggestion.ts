import type { CreateRecipeHooksOptions } from "../types";

import { useQuery } from "@tanstack/react-query";

export type DinnerSuggestion = {
  id: string;
  name: string;
  image: string | null;
  tags: string[];
  averageRating: number | null;
  ratingCount: number;
  matchesSeason: boolean;
  season: "spring" | "summer" | "autumn" | "winter";
};

export type DinnerSuggestionResult = {
  suggestions: DinnerSuggestion[];
  isLoading: boolean;
  refetch: () => void;
};

/**
 * DINNER-01: the "what's for dinner" suggestions. The candidate set is
 * per-cookbook scoped server-side (getDinnerSuggestionCandidates reuses
 * buildViewPolicyCondition), so this hook can never surface a recipe the viewer
 * cannot see. Ranking (season from tags + recent household ratings) happens on
 * the server; the client just renders the ordered list.
 */
export function createUseDinnerSuggestion({ useTRPC }: CreateRecipeHooksOptions) {
  return function useDinnerSuggestion(count = 3): DinnerSuggestionResult {
    const trpc = useTRPC();

    const query = useQuery(trpc.recipes.dinnerSuggestion.queryOptions({ count }));

    return {
      suggestions: (query.data?.suggestions ?? []) as DinnerSuggestion[],
      isLoading: query.isLoading,
      refetch: () => {
        void query.refetch();
      },
    };
  };
}
