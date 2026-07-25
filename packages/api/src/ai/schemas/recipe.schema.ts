import { z } from "zod";

import { nutritionEstimationSchema } from "./nutrition.schema";

/**
 * A single instruction step WITH per-step ingredient and timer linkage
 * (Phase 27, W3 / D-27-W3-03).
 *
 * This is what lets `buildCookFromExtraction` mint a `.cook`: Cooklang needs to
 * know which ingredient is used in which step, and only the model that read the
 * source can say. `ingredients` and `timers` carry `.default([])` so a model that
 * emits nothing but `text` is still valid.
 */
const extractionStepSchema = z.object({
  text: z.string().describe("The full instruction text for this step, in natural prose."),
  ingredients: z
    .array(
      z.object({
        name: z.string().describe("Ingredient name as it appears in THIS step's text"),
        amount: z
          .union([z.number(), z.string(), z.null()])
          .describe("Quantity used in this step; null when unspecified"),
        unit: z.string().nullable().describe("Unit for this step's amount; null when none"),
      })
    )
    .default([])
    .describe("Ingredients this step uses, with the amount used here"),
  timers: z
    .array(
      z.object({
        name: z.string().nullable(),
        amount: z.union([z.number(), z.string()]),
        unit: z.string(),
      })
    )
    .default([])
    .describe("Timers mentioned in this step"),
});

/**
 * A step is an OBJECT or a plain STRING, object branch first (D-27-W3-03).
 *
 * The union is deliberate and load-bearing. `Output.object` validates the model's
 * response against this schema, so a MANDATORY step object would turn any model
 * that ignores the new shape into a total import failure — and this fork's provider
 * and model are user-configurable. A string-shaped response imports exactly as it
 * does today and simply earns no `.cook`.
 */
const extractionStepUnion = z.union([extractionStepSchema, z.string()]);

/**
 * Dual-system recipe schema for AI extraction.
 * Extracts both metric and US measurements simultaneously.
 *
 * NOTE — this schema deliberately declares NO upper-bound (maximum-length)
 * constraint anywhere (T-27-01b). A zod cap here would make an oversize extraction
 * fail the WHOLE import; the caps live at the parser door
 * (`@norish/shared-server/cooklang/limits`), where a breach costs only the `.cook`
 * and the user's import still succeeds. `grep` for that constraint in this file must
 * come back empty — that emptiness is an asserted acceptance criterion.
 */
export const recipeExtractionSchema = z
  .object({
    "@context": z.literal("https://schema.org").describe("Schema.org context"),
    "@type": z.literal("Recipe").describe("Schema.org type"),
    name: z.string().describe("Recipe name/title"),
    description: z.string().nullable().describe("Brief recipe description"),
    notes: z
      .string()
      .nullable()
      .describe("Additional recipe notes only when recipe content explicitly includes them"),
    recipeYield: z
      .union([z.string(), z.number(), z.null()])
      .describe("Number of servings or yield description"),
    prepTime: z
      .string()
      .nullable()
      .describe("Preparation time in ISO 8601 duration format (e.g., PT30M)"),
    cookTime: z
      .string()
      .nullable()
      .describe("Cooking time in ISO 8601 duration format (e.g., PT1H)"),
    totalTime: z.string().nullable().describe("Total time in ISO 8601 duration format"),
    recipeIngredient: z
      .object({
        metric: z
          .array(z.string())
          .describe("Ingredients with metric measurements (g, ml, kg, L, °C)"),
        us: z
          .array(z.string())
          .describe("Ingredients with US measurements (cups, tbsp, tsp, oz, lb, °F)"),
      })
      .strict(),
    recipeInstructions: z
      .object({
        metric: z
          .array(extractionStepUnion)
          .describe("Cooking steps with metric measurements, each with its ingredient linkage"),
        us: z
          .array(extractionStepUnion)
          .describe("Cooking steps with US measurements, each with its ingredient linkage"),
      })
      .strict(),
    keywords: z
      .array(z.string())
      .nullable()
      .describe("Tags including detected allergens (e.g., gluten, dairy, nuts)"),
    categories: z
      .array(z.string())
      .min(1)
      .describe("Meal categories - MUST include at least one of: Breakfast, Lunch, Dinner, Snack"),
    nutrition: nutritionEstimationSchema,
  })
  .strict();

export type RecipeExtractionOutput = z.infer<typeof recipeExtractionSchema>;
