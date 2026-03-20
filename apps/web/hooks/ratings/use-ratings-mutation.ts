"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/app/providers/trpc-provider";

type UserRatingData = { recipeId: string; userRating: number | null; version?: number | null };

export function useRatingsMutation() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const rateMutation = useMutation(
    trpc.ratings.rate.mutationOptions({
      onMutate: async ({ recipeId, rating }) => {
        const userRatingQueryKey = trpc.ratings.getUserRating.queryKey({ recipeId });

        await queryClient.cancelQueries({ queryKey: userRatingQueryKey });

        const previousUserRating = queryClient.getQueryData<UserRatingData>(userRatingQueryKey);

        queryClient.setQueryData<UserRatingData>(userRatingQueryKey, {
          recipeId,
          userRating: rating,
          version: previousUserRating?.version,
        });

        return { previousUserRating, userRatingQueryKey };
      },
    })
  );

  return {
    rateRecipe: (recipeId: string, rating: number) => {
      const userRatingQueryKey = trpc.ratings.getUserRating.queryKey({ recipeId });
      const previousUserRating = queryClient.getQueryData<UserRatingData>(userRatingQueryKey);

      rateMutation.mutate({ recipeId, rating, version: previousUserRating?.version ?? undefined });
    },
    isRating: rateMutation.isPending,
  };
}
