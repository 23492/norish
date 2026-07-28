import type { UnitsMap } from "@norish/config/zod/server-config";
import type { MeasurementSystem } from "@norish/shared/contracts/dto/recipe";
import type { LinkOutcome, StructuredIngredientRef, StructuredRecipe, StructuredStep } from "@norish/shared/cooklang";

import {
  applyCookBackfill,
  GroceryLinkWouldBreakError,
  listRecipeIdsWithoutCookSource,
  StepWouldBeLostError,
} from "@norish/db/repositories/cook-backfill";
import { getRecipeFull } from "@norish/db/repositories/recipes";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { buildCookPayload } from "@norish/shared-server/cooklang/build-payload";
import { dbLogger } from "@norish/shared-server/logger";
import { hasNameAnchor, serializeWithReport } from "@norish/shared/cooklang";

/**
 * The boot-time backfill for every legacy recipe (Phase 27, W5 — COOK-01).
 *
 * D-27-W5-01: this is a DETERMINISTIC seeder, not an AI re-linking pass. It calls
 * no model, so "run it twice, get the same rows" (idempotency) is achievable and
 * nothing here can hang the boot on a provider call.
 *
 * A recipe's own `steps` + `recipe_ingredients` (NATIVE system only) become a
 * `StructuredRecipe`, minted into a `.cook` through the ONLY sanctioned minter
 * (`buildCookPayload` — escaping, the nine caps, `findCookSourceDefect`, the
 * pooled bounded parser), scored, and written by `applyCookBackfill` in the same
 * transaction as its re-derived projection.
 */

/**
 * D-27-W5-03: one appended ingredient in five ("season with salt") is the
 * ordinary best-effort case and needs no human; more than one in five means the
 * prose and the ingredient list have genuinely drifted apart. Comparison is
 * strict `<`, so exactly 0.800 is NOT flagged.
 */
export const COOK_REVIEW_CONFIDENCE_THRESHOLD = 0.8;

export interface CookBackfillOutcome {
  candidates: number;
  derived: number;
  flagged: number;
  refused: number;
  failed: number;
}

/** `total === 0` scores a perfect `1`; otherwise inline/total, rounded to 3 decimals. */
export function cookConfidenceFromLinks(links: LinkOutcome[]): number {
  if (links.length === 0) return 1;

  const inline = links.filter((link) => link.placement === "inline").length;

  return Math.round((inline / links.length) * 1000) / 1000;
}

function isHeading(step: StructuredStep): boolean {
  return step.text.trim().startsWith("#");
}

/**
 * The structural shape `buildStructuredRecipeFromLegacy` actually reads — and no
 * more. Both `FullRecipeDTO` (the read DTO, W5's original caller) and
 * `FullRecipeInsertDTO` (`z.input<FullRecipeInsertSchema>`, the JSON-LD
 * fallback's caller — D-27.1-05) satisfy it, but the two differ in three ways
 * this function must handle explicitly rather than assume away:
 *   - `order`'s z.INPUT type is `unknown` on the insert DTO (`z.coerce.number()`'s
 *     input accepts anything coercible, so its `z.input` widens to `unknown`
 *     rather than `number | string`), so it is coerced with `Number(...)`
 *     before sorting rather than assumed numeric;
 *   - `ingredientName` is OPTIONAL on the insert DTO (the read DTO always has
 *     one), so a row with no name is skipped rather than linked as "";
 *   - per-row `systemUsed` is OPTIONAL on the insert DTO's ingredients, so a
 *     missing value is treated as the recipe's own native system rather than
 *     excluded from it;
 *   - the recipe-level `systemUsed` is ALSO optional on the insert DTO
 *     (`recipes.system_used` carries a DB default of `"metric"`, so
 *     drizzle-zod's insert schema makes it optional), so a missing value here
 *     defaults to `"metric"` — the same default the column itself has;
 *   - `steps` and `recipeIngredients` are ALSO optional on the insert DTO
 *     (`FullRecipeInsertSchema` gives both a `.default([])`), so a missing
 *     array defaults to empty here exactly as it does in the schema.
 */
export interface LegacyProjectionSource {
  name: string;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  url?: string | null;
  systemUsed?: MeasurementSystem | null;
  steps?: ReadonlyArray<{ step: string; order: unknown; systemUsed?: MeasurementSystem | null }>;
  recipeIngredients?: ReadonlyArray<{
    ingredientName?: string | null;
    // z.INPUT for `amount` is `unknown` on the insert DTO too (same
    // coerce-widens-the-input-type reason as `order`, above).
    amount: unknown;
    unit?: string | null;
    order: unknown;
    systemUsed?: MeasurementSystem | null;
  }>;
}

/**
 * PURE: a `LegacyProjectionSource` -> the `StructuredRecipe` the serializer
 * takes, or a refusal reason. No I/O.
 *
 * D-27.1-05: this seeder now also runs on a runtime import path — the JSON-LD
 * fallback (`packages/api/src/parser/jsonld-fallback.ts`) — which extends Phase
 * 27's D-6 ("a one-time deterministic name-match seed is allowed as migration
 * glue, never as a runtime renderer"). The extension is sound for two reasons:
 * (1) no heuristic RENDERER is introduced — D-7 stands, `SmartInstruction` /
 * `applyIngredientLinkMarkup` stay deleted, and the stored `.cook` is rendered
 * by the parser-token renderer like any other recipe's; (2) it is
 * forward-necessary — W6 makes `cook_source` NOT NULL, at which point a non-AI
 * import path that yields NULL becomes a hard failure, so a fallback that can
 * mint a real `cook_source` here closes that gap rather than adding debt.
 */
export function buildStructuredRecipeFromLegacy(
  recipe: LegacyProjectionSource
): { structured: StructuredRecipe } | { refusal: string } {
  const native: MeasurementSystem = recipe.systemUsed ?? "metric";
  const steps = recipe.steps ?? [];
  const recipeIngredients = recipe.recipeIngredients ?? [];
  const nativeSteps = steps
    .filter((step) => (step.systemUsed ?? native) === native)
    .sort((a, b) => Number(a.order) - Number(b.order));
  const nativeIngredients = recipeIngredients
    .filter((ingredient) => (ingredient.systemUsed ?? native) === native)
    // The insert DTO's `ingredientName` is optional (unlike the read DTO's
    // required `string`) — a row with no name cannot be name-anchored to a
    // step, so it is SKIPPED, never linked as an empty string.
    .filter((ingredient) => Boolean(ingredient.ingredientName?.trim()))
    .sort((a, b) => Number(a.order) - Number(b.order));

  if (nativeSteps.length === 0) {
    return { refusal: "no-native-steps" };
  }

  // Deriving against an empty native ingredient list would retire every
  // opposite-system row the moment `deriveProjectionTx` runs — refuse rather
  // than silently drop the recipe's whole ingredient list.
  if (nativeIngredients.length === 0 && recipeIngredients.length > 0) {
    return { refusal: "no-native-ingredients" };
  }

  const structuredSteps: StructuredStep[] = nativeSteps.map((step, index) => ({
    text: step.step,
    order: index,
    ingredients: [],
  }));

  // Longest-name-first: "brown sugar" claims its step before "sugar" does.
  const sortedIngredients = [...nativeIngredients].sort(
    (a, b) => (b.ingredientName as string).length - (a.ingredientName as string).length
  );

  for (const ingredient of sortedIngredients) {
    const ingredientName = ingredient.ingredientName as string;
    let targetIndex = structuredSteps.findIndex(
      (step) => !isHeading(step) && hasNameAnchor(step.text, ingredientName)
    );

    if (targetIndex === -1) {
      targetIndex = structuredSteps.findIndex((step) => !isHeading(step));
    }

    if (targetIndex === -1) targetIndex = 0;

    const ref: StructuredIngredientRef = {
      name: ingredientName,
      // Both DTOs' runtime value is always `number | null` — only the insert
      // DTO's z.INPUT type widens to `unknown` (the coerce reason above).
      amount: ingredient.amount as number | string | null,
      unit: ingredient.unit ?? null,
    };

    structuredSteps[targetIndex]!.ingredients.push(ref);
  }

  return {
    structured: {
      name: recipe.name,
      servings: recipe.servings ?? null,
      prepMinutes: recipe.prepMinutes ?? null,
      cookMinutes: recipe.cookMinutes ?? null,
      totalMinutes: recipe.totalMinutes ?? null,
      source: recipe.url ?? null,
      systemUsed: native,
      steps: structuredSteps,
    },
  };
}

/**
 * Derive, score and write a `.cook` for every recipe with `cook_source IS NULL`.
 * NEVER THROWS (D-27-W5-04 / R4): a per-recipe failure is caught and counted, and
 * a boot-time backfill failure must never cost the boot. Every log line carries
 * ids, counts and reasons only — never a recipe name, an ingredient name or step
 * prose (T-27-05).
 *
 * POST-VERIFICATION FIX (G3): `getUnits()` and `listRecipeIdsWithoutCookSource()`
 * are setup calls that can reject exactly like anything inside the per-recipe
 * loop (a cold DB pool, a missing units config), so they run INSIDE the same
 * guard rather than before it — this function must genuinely never reject, not
 * just never reject once the loop starts.
 */
export async function backfillCookSource(): Promise<CookBackfillOutcome> {
  const outcome: CookBackfillOutcome = {
    candidates: 0,
    derived: 0,
    flagged: 0,
    refused: 0,
    failed: 0,
  };

  let units: UnitsMap;
  let ids: string[];

  try {
    units = await getUnits();
    ids = await listRecipeIdsWithoutCookSource();
  } catch (err) {
    dbLogger.error(
      { module: "cooklang", reason: "setup-failed", err },
      "Cooklang backfill: setup failed, skipping this run"
    );

    return outcome;
  }

  outcome.candidates = ids.length;

  if (ids.length === 0) {
    dbLogger.info({ module: "cooklang" }, "Cooklang backfill: nothing to do");

    return outcome;
  }

  for (const recipeId of ids) {
    try {
      const recipe = await getRecipeFull(recipeId);

      if (!recipe) {
        throw new Error("recipe not found during backfill");
      }

      const built = buildStructuredRecipeFromLegacy(recipe);

      if ("refusal" in built) {
        dbLogger.warn(
          {
            module: "cooklang",
            reason: built.refusal,
            recipeId,
            stepCount: recipe.steps.length,
            ingredientCount: recipe.recipeIngredients.length,
          },
          "Cooklang backfill: recipe refused"
        );
        outcome.refused += 1;
        continue;
      }

      const { structured } = built;
      // Same pure serializer `buildCookPayload` runs internally — assert the
      // report describes the source that gets stored rather than assuming it.
      const report = serializeWithReport(structured, units);
      const payload = await buildCookPayload(structured, units);

      if (!payload) {
        dbLogger.warn(
          {
            module: "cooklang",
            reason: "payload-refused",
            recipeId,
            stepCount: recipe.steps.length,
            ingredientCount: recipe.recipeIngredients.length,
          },
          "Cooklang backfill: payload refused"
        );
        outcome.refused += 1;
        continue;
      }

      const confidence = cookConfidenceFromLinks(report.links);
      const reviewNeeded = confidence < COOK_REVIEW_CONFIDENCE_THRESHOLD;

      await applyCookBackfill({
        recipeId,
        systemUsed: structured.systemUsed,
        cookSource: payload.cookSource,
        cookTokens: payload.cookTokens,
        cookConfidence: confidence,
        reviewNeeded,
        units,
      });

      if (reviewNeeded) outcome.flagged += 1;
      else outcome.derived += 1;
    } catch (err) {
      if (err instanceof GroceryLinkWouldBreakError) {
        dbLogger.warn(
          { module: "cooklang", reason: "grocery-link-would-break", recipeId },
          "Cooklang backfill: grocery link would break"
        );
        outcome.refused += 1;
      } else if (err instanceof StepWouldBeLostError) {
        dbLogger.warn(
          { module: "cooklang", reason: "step-would-be-lost", recipeId },
          "Cooklang backfill: step would be lost"
        );
        outcome.refused += 1;
      } else {
        dbLogger.error(
          { module: "cooklang", reason: "unexpected-error", recipeId, err },
          "Cooklang backfill: unexpected error"
        );
        outcome.failed += 1;
      }
    }
  }

  dbLogger.info(
    {
      module: "cooklang",
      candidates: outcome.candidates,
      derived: outcome.derived,
      flagged: outcome.flagged,
      refused: outcome.refused,
      failed: outcome.failed,
    },
    "Cooklang backfill complete"
  );

  return outcome;
}
