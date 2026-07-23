import { z } from "zod";

import { MAX_RECIPE_PASTE_CHARS } from "@norish/shared/contracts/uploads";
import { MAX_BULK_IMPORT_URLS } from "@norish/shared/lib/helpers";

export const recipeAutocompleteInputSchema = z.object({
  query: z.string().min(1).max(100),
});

export const randomRecipeInputSchema = z.object({
  category: z.enum(["Breakfast", "Lunch", "Dinner", "Snack"]).optional(),
});

// DINNER-01: how many "what's for dinner" suggestions to return (headline +
// alternates). The candidate set is per-cookbook scoped in the repo; this only
// bounds how many ranked picks come back.
export const dinnerSuggestionInputSchema = z.object({
  count: z.number().int().min(1).max(10).optional().default(3),
});

export const recipeImportPasteInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe(
      [
        "Pasted recipe text.",
        "Supports plain text, JSON-LD recipe objects/arrays/@graph payloads, and YAML recipe mappings/arrays.",
        `Each recipe is limited to ${MAX_RECIPE_PASTE_CHARS.toLocaleString()} characters.`,
        "When forcing AI only one recipe will be parsed.",
        'JSON-LD single example: {"@type":"Recipe","name":"Toast","recipeIngredient":["2 slices bread"],"recipeInstructions":["Toast bread"]}',
        'JSON-LD multi example: [{"@type":"Recipe",...},{"@type":"Recipe",...}]',
        "YAML single example: title: Toast\\ningredients:\\n  - 2 slices bread\\nsteps:\\n  - Toast bread",
        "YAML multi example: - title: Toast\\n  ingredients:\\n    - 2 slices bread\\n  steps:\\n    - Toast bread",
      ].join(" ")
    ),
  forceAI: z.boolean().optional(),
});

export const recipeImportPasteOutputSchema = z.object({
  recipeIds: z
    .array(z.uuid())
    .describe(
      "Created recipe IDs in source order. Single imports still return one ID in this array."
    ),
});

export const recipeIdInputSchema = z.object({ recipeId: z.uuid() });

// BULK-01: many URLs in one submission, fanned out over the SAME single-import queue path
// (one job per URL, each carrying the active cookbook). The cap is enforced here too, so
// the limit holds even for direct API callers, not just the UI.
export const recipeImportBulkInputSchema = z.object({
  urls: z
    .array(z.url())
    .min(1)
    .max(MAX_BULK_IMPORT_URLS)
    .describe(
      `Up to ${MAX_BULK_IMPORT_URLS} recipe URLs. Each is enqueued as an independent import ` +
        "job against the active cookbook, with per-item outcome reporting."
    ),
  forceAI: z.boolean().optional(),
});

export const recipeImportBulkOutputSchema = z.object({
  items: z
    .array(
      z.object({
        url: z.string(),
        recipeId: z.uuid(),
        status: z.enum(["queued", "exists", "duplicate"]),
        existingRecipeId: z.string().optional(),
      })
    )
    .describe(
      "Per-URL enqueue outcome in source order: queued (accepted), exists (already in this " +
        "cookbook), or duplicate (already importing). Import success/failure then arrives " +
        "per item over the realtime bus."
    ),
});
