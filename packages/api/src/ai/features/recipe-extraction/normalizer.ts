/**
 * AI Recipe Extraction - Shared output normalization.
 *
 * Normalizes dual-system AI extraction output (metric + US) into
 * a FullRecipeInsertDTO with both measurement systems.
 */

import { decode } from "html-entities";

import type { RecipeExtractionOutput } from "@norish/api/ai/schemas/recipe.schema";
import type { FullRecipeInsertDTO, RecipeCategory } from "@norish/shared/contracts/dto/recipe";
import { normalizeRecipeFromJson } from "@norish/api/parser/normalize";
import { matchCategory } from "@norish/shared-server/ai/utils/category-matcher";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { aiLogger } from "@norish/shared-server/logger";
import { parseIngredientWithDefaults } from "@norish/shared/lib/helpers";

/** One per-step ingredient reference, as the model emits it (D-27-W3-03). */
export interface ExtractionIngredientRef {
  name: string;
  amount: number | string | null;
  unit: string | null;
}

/** One per-step timer reference, as the model emits it. */
export interface ExtractionTimerRef {
  name: string | null;
  amount: number | string;
  unit: string;
}

/** The internal, uniform shape both branches of the step union map onto. */
export interface ExtractionStep {
  text: string;
  ingredients: ExtractionIngredientRef[];
  timers: ExtractionTimerRef[];
}

function coerceIngredientRefs(raw: unknown): ExtractionIngredientRef[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): ExtractionIngredientRef[] => {
    if (!entry || typeof entry !== "object") return [];

    const ref = entry as Record<string, unknown>;

    if (typeof ref.name !== "string" || ref.name.trim() === "") return [];

    const amount = ref.amount;

    return [
      {
        name: ref.name,
        amount:
          typeof amount === "number" || typeof amount === "string" ? amount : null,
        unit: typeof ref.unit === "string" ? ref.unit : null,
      },
    ];
  });
}

function coerceTimerRefs(raw: unknown): ExtractionTimerRef[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): ExtractionTimerRef[] => {
    if (!entry || typeof entry !== "object") return [];

    const ref = entry as Record<string, unknown>;
    const amount = ref.amount;

    if (typeof amount !== "number" && typeof amount !== "string") return [];
    if (typeof ref.unit !== "string" || ref.unit.trim() === "") return [];

    return [{ name: typeof ref.name === "string" ? ref.name : null, amount, unit: ref.unit }];
  });
}

/**
 * Map either branch of the step union onto the uniform internal shape
 * (D-27-W3-03).
 *
 * TOTAL BY CONTRACT: it never throws, whatever it is handed. A string becomes
 * `{ text, ingredients: [], timers: [] }`; an object is mapped through with its
 * refs defensively coerced; anything else is dropped. That totality is what keeps
 * a malformed model response from failing an import that succeeds today.
 */
export function coerceExtractionSteps(raw: unknown): ExtractionStep[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): ExtractionStep[] => {
    if (typeof entry === "string") return [{ text: entry, ingredients: [], timers: [] }];

    if (!entry || typeof entry !== "object") return [];

    const step = entry as Record<string, unknown>;

    if (typeof step.text !== "string") return [];

    return [
      {
        text: step.text,
        ingredients: coerceIngredientRefs(step.ingredients),
        timers: coerceTimerRefs(step.timers),
      },
    ];
  });
}

/**
 * Options for normalizing AI extraction output.
 */
export interface NormalizeExtractionOptions {
  /**
   * Source URL of the recipe (for URL-based imports).
   */
  url?: string;

  /**
   * Image URL or path (for video imports with thumbnails).
   */
  image?: string;

  /**
   * Image candidates from HTML (for HTML-based imports).
   */
  imageCandidates?: string[];

  /**
   * Recipe ID (for image storage paths).
   */
  recipeId: string;
}

/**
 * Validation result for AI extraction output.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: {
    hasName: boolean;
    metricIngredients: number;
    usIngredients: number;
    metricSteps: number;
    usSteps: number;
  };
}

/**
 * Validate that AI extraction output has all required fields.
 */
export function validateExtractionOutput(output: RecipeExtractionOutput | null): ValidationResult {
  if (!output || Object.keys(output).length === 0) {
    return { valid: false, error: "AI returned empty response" };
  }

  const details = {
    hasName: !!output.name,
    metricIngredients: output.recipeIngredient?.metric?.length ?? 0,
    usIngredients: output.recipeIngredient?.us?.length ?? 0,
    metricSteps: output.recipeInstructions?.metric?.length ?? 0,
    usSteps: output.recipeInstructions?.us?.length ?? 0,
  };

  if (
    !output.name ||
    !output.recipeIngredient?.metric?.length ||
    !output.recipeIngredient?.us?.length ||
    !output.recipeInstructions?.metric?.length ||
    !output.recipeInstructions?.us?.length
  ) {
    return {
      valid: false,
      error: "Recipe extraction failed - missing required fields",
      details,
    };
  }

  return { valid: true, details };
}

/**
 * Normalize AI extraction output to FullRecipeInsertDTO.
 *
 * Takes the dual-system output from AI extraction (with both metric and US
 * measurements) and normalizes it to the internal DTO format with both
 * measurement systems preserved.
 *
 * @param output - The AI extraction output with metric and US systems.
 * @param options - Additional normalization options.
 * @returns The normalized recipe DTO, or null if normalization fails.
 */
export async function normalizeExtractionOutput(
  output: RecipeExtractionOutput,
  options: NormalizeExtractionOptions
): Promise<FullRecipeInsertDTO | null> {
  const { url, image, imageCandidates, recipeId } = options;

  // D-27-W3-03: a step may arrive as an object with linkage or as a plain string.
  // Flatten to prose HERE so everything downstream — `normalizeRecipeFromJson`,
  // `parseSteps` and every JSON-LD behaviour — keeps receiving a plain `string[]`
  // and is byte-identical to today for a string-shaped extraction. The linkage is
  // read separately by `buildCookFromExtraction`, never through this path.
  const metricStepTexts = coerceExtractionSteps(output.recipeInstructions.metric).map(
    (step) => step.text
  );
  const usStepTexts = coerceExtractionSteps(output.recipeInstructions.us).map((step) => step.text);

  // Build metric version for base normalization
  // The AI schema doesn't include image - it comes from HTML/video metadata
  const metricVersion = {
    ...output,
    image: image ?? imageCandidates,
    recipeIngredient: output.recipeIngredient.metric,
    recipeInstructions: metricStepTexts,
  };

  const normalized = await normalizeRecipeFromJson(metricVersion, recipeId);

  if (!normalized) {
    aiLogger.warn(
      {
        recipeName: output.name,
        metricIngredients: output.recipeIngredient?.metric?.length ?? 0,
        metricSteps: output.recipeInstructions?.metric?.length ?? 0,
      },
      "Failed to normalize recipe from JSON-LD - normalizeRecipeFromJson returned null"
    );

    return null;
  }

  // Parse US ingredients and steps
  const units = await getUnits();
  const usIngredients = parseIngredientWithDefaults(
    output.recipeIngredient.us.map((ing: string) => decode(ing)),
    units
  );
  const usSteps = usStepTexts.map((step, i) => ({
    step: decode(step),
    order: i + 1,
    systemUsed: "us" as const,
  }));

  // Set URL if provided
  normalized.url = url ?? null;
  normalized.notes = typeof output.notes === "string" ? decode(output.notes) : null;

  const metricIngredients = (normalized.recipeIngredients ?? []).map((ing) => ({
    ...ing,
    systemUsed: "metric" as const,
  }));

  const metricSteps = (normalized.steps ?? []).map((step) => ({
    ...step,
    systemUsed: "metric" as const,
  }));

  // Combine both measurement systems
  normalized.recipeIngredients = [
    ...metricIngredients,
    ...usIngredients.map((ing, i) => ({
      ingredientId: null,
      ingredientName: ing.description,
      amount: ing.quantity != null ? ing.quantity : null,
      unit: ing.unitOfMeasureID,
      systemUsed: "us" as const,
      order: i,
    })),
  ];

  normalized.steps = [...metricSteps, ...usSteps];

  const normalizedCategories = (output.categories ?? [])
    .filter((category): category is string => typeof category === "string" && category.length > 0)
    .map((category) => matchCategory(category))
    .filter((category): category is RecipeCategory => category !== null)
    .filter((category, index, categories) => categories.indexOf(category) === index);

  normalized.categories = normalizedCategories;

  // Log if no categories were matched (helps debug AI responses)
  if (normalizedCategories.length === 0 && (output.categories?.length ?? 0) > 0) {
    aiLogger.warn(
      { rawCategories: output.categories, recipeName: output.name },
      "AI returned categories but none matched valid category names"
    );
  }

  return normalized;
}

/**
 * Get logging context for AI extraction results.
 */
export function getExtractionLogContext(
  output: RecipeExtractionOutput,
  normalized: FullRecipeInsertDTO | null
): Record<string, unknown> {
  return {
    recipeName: output.name,
    metricIngredients: output.recipeIngredient?.metric?.length ?? 0,
    usIngredients: output.recipeIngredient?.us?.length ?? 0,
    metricSteps: output.recipeInstructions?.metric?.length ?? 0,
    usSteps: output.recipeInstructions?.us?.length ?? 0,
    ...(normalized && {
      totalIngredients: normalized.recipeIngredients?.length ?? 0,
      totalSteps: normalized.steps?.length ?? 0,
      systemUsed: normalized.systemUsed,
      tags: normalized.tags,
    }),
    categories: output.categories,
  };
}
