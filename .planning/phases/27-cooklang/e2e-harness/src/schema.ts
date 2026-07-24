// SPIKE — Phase 27 (COOK-01). The NEW per-step extraction schema.
// -----------------------------------------------------------------------------
// This mirrors the real `packages/api/src/ai/schemas/recipe.schema.ts` EXCEPT for
// the change proposed in 27-EXTRACTION-PROMPT.md: `recipeInstructions.{metric,us}`
// becomes an array of STEP OBJECTS ({ text, ingredients[], timers[] }) instead of an
// array of strings, carrying the ingredient↔step linkage + per-step amounts.
//
// The flat `recipeIngredient.{metric,us}` string list STAYS (source of truth for the
// structured tables / shopping list, D-1); the per-step `ingredients[]` are refs
// into it plus the amount used IN THAT STEP.
//
// It is written in zod 4 (the repo catalog pin, 4.4.2), the same version the live
// extraction uses, so this schema is drop-in compatible with the AI-SDK
// `Output.object({ schema })` call in `recipe-parser.ts`.
// -----------------------------------------------------------------------------

import { z } from "zod";

export const ingredientRefSchema = z.object({
  name: z
    .string()
    .describe("Ingredient name EXACTLY as it appears in the recipeIngredient list for this system"),
  amount: z
    .union([z.number(), z.string(), z.null()])
    .describe("Quantity used IN THIS STEP; null if 'to taste' / unspecified"),
  unit: z.string().nullable().describe("Unit for this step's amount; null if none"),
});

export const timerRefSchema = z.object({
  name: z.string().nullable().describe("Timer name if the text names it, else null"),
  amount: z.number().describe("Timer duration amount"),
  unit: z.string().describe("Timer duration unit, e.g. minutes"),
});

export const stepSchema = z.object({
  text: z.string().describe("The full instruction text for this step, in natural prose."),
  ingredients: z
    .array(ingredientRefSchema)
    .describe("Ingredients used in THIS step, with the amount used here"),
  timers: z
    .array(timerRefSchema)
    .default([])
    .describe("Named/anonymous timers mentioned in this step"),
});

export type ExtractionStep = z.infer<typeof stepSchema>;

/**
 * The Cooklang-ready extraction schema. `.strict()` on the top level is deliberately
 * relaxed to a loose object here so the harness tolerates extra keys a live model
 * may emit (nutrition, @context, etc.) without failing the round-trip that matters.
 * The parts that MUST be right for Cooklang — the per-step linkage — are strict.
 */
export const cooklangExtractionSchema = z.object({
  "@context": z.literal("https://schema.org").optional(),
  "@type": z.literal("Recipe").optional(),
  name: z.string().describe("Recipe name/title"),
  description: z.string().nullable().optional(),
  recipeYield: z.union([z.string(), z.number(), z.null()]).optional(),
  prepTime: z.string().nullable().optional(),
  cookTime: z.string().nullable().optional(),
  totalTime: z.string().nullable().optional(),
  recipeIngredient: z.object({
    metric: z.array(z.string()).describe("Ingredients with metric measurements"),
    us: z.array(z.string()).describe("Ingredients with US measurements"),
  }),
  recipeInstructions: z.object({
    metric: z.array(stepSchema).describe("Cooking steps (metric) with per-step ingredient linkage"),
    us: z.array(stepSchema).describe("Cooking steps (US) with per-step ingredient linkage"),
  }),
  keywords: z.array(z.string()).nullable().optional(),
  categories: z.array(z.string()).min(1).describe("At least one of: Breakfast, Lunch, Dinner, Snack"),
  source: z.string().nullable().optional(),
});

export type CooklangExtraction = z.infer<typeof cooklangExtractionSchema>;
