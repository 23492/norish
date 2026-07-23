import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RecipeImportStage } from "@norish/shared/contracts";

import type { CreateRecipeHooksOptions } from "../types";
import type { ImportStagesMap } from "./use-recipes-cache";
import { IMPORT_STAGES_QUERY_KEY } from "./use-recipes-cache";

export function createUsePendingRecipesQuery({ useTRPC }: CreateRecipeHooksOptions) {
  return function usePendingRecipesQuery() {
    const trpc = useTRPC();

    const { data, isLoading, error } = useQuery({
      ...trpc.recipes.getPending.queryOptions(),
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
    });

    // IMPORT-UX-01: client-only cache, written by the importProgress subscription. It has
    // no server queryFn — the initial `{}` is only replaced via setQueryData, and it must
    // never be refetched away, so gcTime/staleTime are Infinity and refetch is disabled.
    const { data: stageData } = useQuery<ImportStagesMap>({
      queryKey: IMPORT_STAGES_QUERY_KEY,
      queryFn: () => ({}),
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });

    const pendingRecipeIds = useMemo(() => {
      return new Set((data ?? []).map((p) => p.recipeId));
    }, [data]);

    const importStages = useMemo(() => {
      return new Map<string, RecipeImportStage>(Object.entries(stageData ?? {}));
    }, [stageData]);

    return {
      pendingRecipeIds,
      importStages,
      isLoading,
      error,
    };
  };
}
