import { z } from "zod";

export const RatingInputSchema = z.object({
  recipeId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  version: z.number().int().positive().optional(),
});

export const RatingGetInputSchema = z.object({
  recipeId: z.uuid(),
});

// RATE-01: a single rater surfaced on the recipe (display name + their stars).
// `name` is null when the user's display name is missing/undecryptable.
export const RecipeRaterSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  updatedAt: z.date(),
});

// RATE-01: the per-user "rated by <name> ★★★★" list for a recipe, paired with
// the aggregate so the detail view can render "★ 4.2 (3 ratings)" + the names.
export const RecipeRatersSchema = z.object({
  recipeId: z.uuid(),
  averageRating: z.number().nullable(),
  ratingCount: z.number().int(),
  raters: z.array(RecipeRaterSchema),
});
