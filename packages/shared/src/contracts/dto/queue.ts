export interface PendingRecipeDTO {
  recipeId: string;
  url: string;
  addedAt: number;
}

/**
 * IMPORT-UX-01 — honest, observable stages of a running recipe import.
 *
 * These are the transitions the worker can actually witness (not a synthetic timer):
 * - `fetching` — the URL is being fetched + extracted via Camoufox.
 * - `saving`   — extraction succeeded; the recipe is being written to the DB.
 *
 * The queued→started transition is already carried by `importStarted`; completion by
 * `imported` / `failed`. Durations are genuinely unknown, so the UI shows the stage
 * label with an indeterminate indicator rather than faking a percentage bar.
 */
export const RECIPE_IMPORT_STAGES = ["fetching", "saving"] as const;

export type RecipeImportStage = (typeof RECIPE_IMPORT_STAGES)[number];

export interface PendingImageImportDTO {
  recipeId: string;
  fileCount: number;
  addedAt: number;
}
