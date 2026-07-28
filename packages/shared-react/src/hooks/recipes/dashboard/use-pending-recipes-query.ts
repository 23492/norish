import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { RecipeImportStage } from "@norish/shared/contracts";

import type { CreateRecipeHooksOptions } from "../types";
import type { FailedImportsMap, ImportStagesMap } from "./use-recipes-cache";
import { FAILED_IMPORTS_QUERY_KEY, IMPORT_STAGES_QUERY_KEY } from "./use-recipes-cache";

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

    // D-27.1-07: client-only cache, written by the `failed` subscription. Same shape as
    // `stageData` above — no server queryFn, refetch disabled, cleared only via
    // `dismissFailedImport` / a subsequent `onImported`/`onCreated` for the same id.
    const { data: failedData } = useQuery<FailedImportsMap>({
      queryKey: FAILED_IMPORTS_QUERY_KEY,
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

    const failedImports = useMemo(() => {
      return new Map<string, FailedImportsMap[string]>(Object.entries(failedData ?? {}));
    }, [failedData]);

    return {
      pendingRecipeIds,
      importStages,
      failedImports,
      isLoading,
      error,
    };
  };
}
