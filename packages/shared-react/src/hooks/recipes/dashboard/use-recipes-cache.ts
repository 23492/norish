import type { InfiniteData } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type {
  PendingRecipeDTO,
  RecipeDashboardDTO,
  RecipeImportStage,
} from "@norish/shared/contracts";

import type { CreateRecipeHooksOptions } from "../types";

export const OPTIMISTIC_PENDING_RECIPE_PREFIX = "optimistic-pending-recipe:";

/**
 * IMPORT-UX-01 — client-only cache of the current honest stage per pending import,
 * fed by the cookbook-scoped `importProgress` realtime event. Keyed by recipe id; an entry
 * is cleared once the import lands (`imported` / `failed` / `created`).
 */
export const IMPORT_STAGES_QUERY_KEY = ["recipes", "importStages"] as const;

export type ImportStagesMap = Record<string, RecipeImportStage>;

function isOptimisticPendingRecipeId(recipeId: string): boolean {
  return recipeId.startsWith(OPTIMISTIC_PENDING_RECIPE_PREFIX);
}

export type InfiniteRecipeData = InfiniteData<{
  recipes: RecipeDashboardDTO[];
  total: number;
  nextCursor: number | null;
}>;

export type RecipesCacheHelpers = {
  setAllRecipesData: (
    updater: (prev: InfiniteRecipeData | undefined) => InfiniteRecipeData | undefined
  ) => void;
  invalidate: () => void;
  addPendingRecipe: (id: string) => void;
  replacePendingRecipe: (fromId: string, toId: string) => void;
  replaceOldestOptimisticPendingRecipe: (recipeId: string) => void;
  removePendingRecipe: (id: string) => void;
  setImportStage: (id: string, stage: RecipeImportStage) => void;
  clearImportStage: (id: string) => void;
  addAutoTaggingRecipe: (id: string) => void;
  removeAutoTaggingRecipe: (id: string) => void;
  addAllergyDetectionRecipe: (id: string) => void;
  removeAllergyDetectionRecipe: (id: string) => void;
};

export function createUseRecipesCacheHelpers({ useTRPC }: CreateRecipeHooksOptions) {
  return function useRecipesCacheHelpers(): RecipesCacheHelpers {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const recipesBaseKey = trpc.recipes.list.queryKey({});
    const recipesPath = useMemo(() => [recipesBaseKey[0]], [recipesBaseKey]);

    const pendingKey = trpc.recipes.getPending.queryKey();
    const autoTaggingKey = trpc.recipes.getPendingAutoTagging.queryKey();
    const allergyDetectionKey = trpc.recipes.getPendingAllergyDetection.queryKey();

    const setAllRecipesData = useCallback(
      (updater: (prev: InfiniteRecipeData | undefined) => InfiniteRecipeData | undefined) => {
        const queries = queryClient.getQueriesData<InfiniteRecipeData>({
          queryKey: recipesPath,
        });

        for (const [key] of queries) {
          queryClient.setQueryData<InfiniteRecipeData>(key, updater);
        }
      },
      [queryClient, recipesPath]
    );

    const invalidate = useCallback(() => {
      queryClient.invalidateQueries({ queryKey: recipesPath });
    }, [queryClient, recipesPath]);

    const addPendingRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<PendingRecipeDTO[]>(pendingKey, (prev) => {
          const arr = prev ?? [];

          if (arr.some((p) => p.recipeId === recipeId)) return arr;

          return [...arr, { recipeId, url: "", addedAt: Date.now() }];
        });
      },
      [queryClient, pendingKey]
    );

    const replacePendingRecipe = useCallback(
      (fromId: string, toId: string) => {
        queryClient.setQueryData<PendingRecipeDTO[]>(pendingKey, (prev) => {
          const arr = prev ?? [];

          if (fromId === toId) {
            return arr;
          }

          const next = arr.map((pending) =>
            pending.recipeId === fromId ? { ...pending, recipeId: toId } : pending
          );

          return next.filter(
            (pending, index) =>
              next.findIndex((item) => item.recipeId === pending.recipeId) === index
          );
        });
      },
      [queryClient, pendingKey]
    );

    const replaceOldestOptimisticPendingRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<PendingRecipeDTO[]>(pendingKey, (prev) => {
          const arr = prev ?? [];

          if (arr.some((pending) => pending.recipeId === recipeId)) {
            return arr;
          }

          const optimisticPending = arr.find((pending) =>
            isOptimisticPendingRecipeId(pending.recipeId)
          );

          if (!optimisticPending) {
            return [...arr, { recipeId, url: "", addedAt: Date.now() }];
          }

          return arr.map((pending) =>
            pending.recipeId === optimisticPending.recipeId ? { ...pending, recipeId } : pending
          );
        });
      },
      [queryClient, pendingKey]
    );

    const clearImportStage = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<ImportStagesMap>(IMPORT_STAGES_QUERY_KEY, (prev) => {
          if (!prev || !(recipeId in prev)) return prev;

          const next = { ...prev };

          delete next[recipeId];

          return next;
        });
      },
      [queryClient]
    );

    const setImportStage = useCallback(
      (recipeId: string, stage: RecipeImportStage) => {
        queryClient.setQueryData<ImportStagesMap>(IMPORT_STAGES_QUERY_KEY, (prev) => ({
          ...(prev ?? {}),
          [recipeId]: stage,
        }));
      },
      [queryClient]
    );

    const removePendingRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<PendingRecipeDTO[]>(pendingKey, (prev) => {
          const arr = prev ?? [];

          return arr.filter((p) => p.recipeId !== recipeId);
        });
        // The import has landed (or been abandoned); drop any lingering progress stage.
        clearImportStage(recipeId);
      },
      [queryClient, pendingKey, clearImportStage]
    );

    const addAutoTaggingRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<string[]>(autoTaggingKey, (prev) => {
          const arr = prev ?? [];

          if (arr.includes(recipeId)) return arr;

          return [...arr, recipeId];
        });
      },
      [queryClient, autoTaggingKey]
    );

    const removeAutoTaggingRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<string[]>(autoTaggingKey, (prev) => {
          const arr = prev ?? [];

          return arr.filter((id) => id !== recipeId);
        });
      },
      [queryClient, autoTaggingKey]
    );

    const addAllergyDetectionRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<string[]>(allergyDetectionKey, (prev) => {
          const arr = prev ?? [];

          if (arr.includes(recipeId)) return arr;

          return [...arr, recipeId];
        });
      },
      [queryClient, allergyDetectionKey]
    );

    const removeAllergyDetectionRecipe = useCallback(
      (recipeId: string) => {
        queryClient.setQueryData<string[]>(allergyDetectionKey, (prev) => {
          const arr = prev ?? [];

          return arr.filter((id) => id !== recipeId);
        });
      },
      [queryClient, allergyDetectionKey]
    );

    return {
      setAllRecipesData,
      invalidate,
      addPendingRecipe,
      replacePendingRecipe,
      replaceOldestOptimisticPendingRecipe,
      removePendingRecipe,
      setImportStage,
      clearImportStage,
      addAutoTaggingRecipe,
      removeAutoTaggingRecipe,
      addAllergyDetectionRecipe,
      removeAllergyDetectionRecipe,
    };
  };
}
