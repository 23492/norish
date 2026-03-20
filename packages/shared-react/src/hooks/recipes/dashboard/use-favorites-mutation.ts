import type { CreateRecipeHooksOptions } from "../types";

import { useMutation, useQueryClient } from "@tanstack/react-query";


export type FavoritesMutationResult = {
  toggleFavorite: (recipeId: string) => void;
  isToggling: boolean;
};

type FavoritesListData = {
  favoriteIds: string[];
  favoriteVersions: Record<string, number>;
};

export function createUseFavoritesMutation({ useTRPC }: CreateRecipeHooksOptions) {
  return function useFavoritesMutation(): FavoritesMutationResult {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const queryKey = trpc.favorites.list.queryKey();

    const toggleMutation = useMutation(
      trpc.favorites.toggle.mutationOptions({
        onMutate: async ({ recipeId }) => {
          await queryClient.cancelQueries({ queryKey });

          const previousData = queryClient.getQueryData<FavoritesListData>(queryKey);

          queryClient.setQueryData<FavoritesListData>(queryKey, (old) => {
            if (!old) {
              return { favoriteIds: [recipeId], favoriteVersions: {} };
            }

            const isFavorite = old.favoriteIds.includes(recipeId);

            return {
              favoriteIds: isFavorite
                ? old.favoriteIds.filter((id) => id !== recipeId)
                : [...old.favoriteIds, recipeId],
              favoriteVersions: isFavorite
                ? Object.fromEntries(
                    Object.entries(old.favoriteVersions).filter(([id]) => id !== recipeId)
                  )
                : old.favoriteVersions,
            };
          });

          return { previousData };
        },
        onError: (_err, _variables, context) => {
          if (context?.previousData) {
            queryClient.setQueryData(queryKey, context.previousData);
          }
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey });
        },
      })
    );

    const toggleFavorite = (recipeId: string) => {
      const favorites = queryClient.getQueryData<FavoritesListData>(queryKey);

      toggleMutation.mutate({
        recipeId,
        version: favorites?.favoriteVersions[recipeId],
      });
    };

    return {
      toggleFavorite,
      isToggling: toggleMutation.isPending,
    };
  };
}
