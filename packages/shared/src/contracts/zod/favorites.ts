import { z } from "zod";

export const FavoriteToggleInputSchema = z.object({
  recipeId: z.uuid(),
  version: z.number().int().positive().optional(),
});

export const FavoriteCheckInputSchema = z.object({
  recipeId: z.uuid(),
});

export const FavoriteBatchCheckInputSchema = z.object({
  recipeIds: z.array(z.uuid()),
});
