/**
 * AI Recipe Extraction - Shared output normalization.
 *
 * Normalizes dual-system AI extraction output (metric + US) into
 * a FullRecipeInsertDTO with both measurement systems.
 */

import { decode } from "html-entities";

import type { RecipeExtractionOutput } from "@norish/api/ai/schemas/recipe.schema";
import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookPayload } from "@norish/shared-server/cooklang/build-payload";
import type {
  FullRecipeInsertDTO,
  MeasurementSystem,
  RecipeCategory,
} from "@norish/shared/contracts/dto/recipe";
import type {
  StructuredIngredientRef,
  StructuredRecipe,
  StructuredStep,
  StructuredTimerRef,
} from "@norish/shared/cooklang";
import { normalizeRecipeFromJson } from "@norish/api/parser/normalize";
import { matchCategory } from "@norish/shared-server/ai/utils/category-matcher";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { buildCookPayload } from "@norish/shared-server/cooklang/build-payload";
import { aiLogger } from "@norish/shared-server/logger";
import { parseIngredientWithDefaults } from "@norish/shared/lib/helpers";
import { normalizeIngredientLinkName } from "@norish/shared/lib/ingredient-token";

export type { CookPayload };

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
 * The extraction channel's payload: the DTO plus the optional server-authored
 * `.cook` (D-27-W3-02).
 *
 * The pair is EXPLICIT and travels ALONGSIDE the DTO, never inside it.
 * `FullRecipeInsertDTO` *is* a tRPC input type (`recipes.create`, paste-import's
 * `FullRecipeInsertSchema.safeParse`), so hanging a `cook` key on it — even
 * optionally — would leave a `.cook` one `.extend()` away from being
 * client-supplied, and untrusted text one step away from the WASM parser
 * (D-27-W2-01/02). `cook` is a SERVER-SIDE argument only.
 */
export interface ExtractedRecipe {
  recipe: FullRecipeInsertDTO;
  cook: CookPayload | null;
}

/**
 * Split a normalized name into comparison words.
 *
 * Punctuation is dropped so `"oil or melted butter, for frying"` yields a clean
 * `butter` token, and digits are kept so `"100 g plain flour"` keeps its shape.
 */
function linkWords(name: string): string[] {
  return normalizeIngredientLinkName(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Does `haystack` contain `needle` as a contiguous run of whole words? */
function containsWholeWordRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;

  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) {
      return true;
    }
  }

  return false;
}

/** Does `words` begin with `prefix` on a whole-word boundary? */
function startsWithWholeWords(words: string[], prefix: string[]): boolean {
  if (prefix.length === 0 || prefix.length > words.length) return false;

  return prefix.every((word, index) => words[index] === word);
}

/**
 * Is this flat `recipeIngredient` entry accounted for by this per-step ref?
 *
 * Matching is LOOSE ON PURPOSE, in exactly two directions, because the two lists
 * are written differently by design:
 *
 * 1. The flat entry is a whole line (`"100 g plain flour"`) while the ref is the
 *    word from the step's sentence (`"flour"`), so a ref that appears in the flat
 *    line as a whole-word run counts.
 * 2. The ref may carry trailing qualifiers the flat entry omits
 *    (`"salt to taste"` for flat `"salt"`), so a ref that STARTS WITH the flat
 *    entry counts.
 *
 * Direction 2 is a PREFIX rule, not a substring one, and that is the load-bearing
 * detail: flat `"sugar"` must NOT be considered covered by ref `"brown sugar"`.
 * "brown sugar" is a different ingredient from "sugar" — W1's serializer sorts
 * longest-name-first precisely so the two do not collide — and treating the longer
 * name as covering the shorter one would let the projection drop the plain sugar
 * row. A strict-equality rule, at the other extreme, would refuse every real
 * recipe and quietly disable this wave.
 */
function refCoversFlatIngredient(flatWords: string[], refWords: string[]): boolean {
  return (
    containsWholeWordRun(flatWords, refWords) || startsWithWholeWords(refWords, flatWords)
  );
}

function toStructuredIngredientRef(ref: ExtractionIngredientRef): StructuredIngredientRef {
  return { name: ref.name, amount: ref.amount, unit: ref.unit };
}

function toStructuredTimerRef(ref: ExtractionTimerRef): StructuredTimerRef {
  return { name: ref.name, amount: ref.amount, unit: ref.unit };
}

/**
 * Mint the `.cook` for an AI extraction — the ONLY new minting call site in W3.
 *
 * It goes through `buildCookPayload`, which is one of the two and only two doors
 * to the WASM parser (T-27-01): the size caps and the parse-cleanly self-check are
 * applied there, not here. There is deliberately no other path.
 *
 * FOUR WAYS THIS RETURNS `null`, and every one of them is FREE for the user
 * (no `cook` argument, legacy projection written in full, import succeeds):
 *
 * 1. no step carries linkage — a string-shaped extraction (D-27-W3-03). The
 *    ORDINARY case for a model that ignored the new shape, so it logs at DEBUG.
 * 2. THE COVERAGE GATE (D-27-W3-04): a flat `recipeIngredient` entry that no step
 *    references. With a `cook`, `deriveProjectionTx` OWNS `recipe_ingredients` and
 *    builds them from the per-step refs, so an unreferenced flat ingredient would
 *    be SILENTLY DELETED from the recipe and from everything the shopping list can
 *    add. Refusing costs nothing (W5's backfill revisits every `cook_source IS
 *    NULL` recipe); losing an ingredient costs a lot. Logged at ERROR with COUNTS
 *    ONLY — an ingredient name is per-cookbook data (T-27-05).
 * 3. a size cap breach, and 4. output that does not parse with an empty report —
 *    both decided and logged inside `buildCookPayload`.
 *
 * Extra refs BEYOND the flat list are not a failure: the serializer already
 * tolerates them, and they cannot lose a row.
 *
 * @param output - The raw dual-system extraction output.
 * @param normalized - The DTO `normalizeExtractionOutput` produced from it.
 * @param units - The server's unit vocabulary, for canonical `%unit` emission.
 * @returns The minted payload, or `null` when the recipe earns no `.cook`.
 */
export function buildCookFromExtraction(
  output: RecipeExtractionOutput,
  normalized: FullRecipeInsertDTO,
  units: UnitsMap
): CookPayload | null {
  // D-2: one `.cook` carries ONE unit system, and it is the recipe's NATIVE one —
  // the system `parseIngredients` inferred while normalizing.
  const systemUsed: MeasurementSystem = normalized.systemUsed ?? "metric";
  const steps = coerceExtractionSteps(output.recipeInstructions?.[systemUsed]);
  const flatIngredients = output.recipeIngredient?.[systemUsed] ?? [];

  const refCount = steps.reduce((total, step) => total + step.ingredients.length, 0);

  if (refCount === 0) {
    aiLogger.debug(
      {
        module: "cooklang",
        reason: "no-step-linkage",
        stepCount: steps.length,
        flatCount: flatIngredients.length,
      },
      "Extraction carried no per-step ingredient linkage; keeping the legacy projection"
    );

    return null;
  }

  const refWordLists = steps.flatMap((step) => step.ingredients.map((ref) => linkWords(ref.name)));

  const missingCount = flatIngredients.filter((flat) => {
    const flatWords = linkWords(flat);

    if (flatWords.length === 0) return false;

    return !refWordLists.some((refWords) => refCoversFlatIngredient(flatWords, refWords));
  }).length;

  if (missingCount > 0) {
    aiLogger.error(
      {
        module: "cooklang",
        reason: "incomplete-ingredient-coverage",
        flatCount: flatIngredients.length,
        missingCount,
        stepCount: steps.length,
        refCount,
      },
      "Extraction did not reference every ingredient; keeping the legacy projection"
    );

    return null;
  }

  const structuredSteps: StructuredStep[] = steps.map((step, index) => ({
    text: step.text,
    order: index + 1,
    ingredients: step.ingredients.map(toStructuredIngredientRef),
    timers: step.timers.map(toStructuredTimerRef),
  }));

  const structured: StructuredRecipe = {
    name: normalized.name,
    servings: normalized.servings ?? null,
    prepMinutes: normalized.prepMinutes ?? null,
    cookMinutes: normalized.cookMinutes ?? null,
    totalMinutes: normalized.totalMinutes ?? null,
    source: normalized.url ?? null,
    systemUsed,
    steps: structuredSteps,
  };

  return buildCookPayload(structured, units);
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
