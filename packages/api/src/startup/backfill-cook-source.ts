import type { UnitsMap } from "@norish/config/zod/server-config";
import type { FullRecipeDTO } from "@norish/shared/contracts/dto/recipe";
import type { LinkOutcome, StructuredIngredientRef, StructuredRecipe, StructuredStep } from "@norish/shared/cooklang";

import {
  applyCookBackfill,
  GroceryLinkWouldBreakError,
  listRecipeIdsWithoutCookSource,
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
 * PURE: a legacy `FullRecipeDTO` -> the `StructuredRecipe` the serializer takes,
 * or a refusal reason. No I/O.
 */
export function buildStructuredRecipeFromLegacy(
  recipe: FullRecipeDTO
): { structured: StructuredRecipe } | { refusal: string } {
  const native = recipe.systemUsed;
  const nativeSteps = recipe.steps.filter((step) => step.systemUsed === native).sort((a, b) => a.order - b.order);
  const nativeIngredients = recipe.recipeIngredients
    .filter((ingredient) => ingredient.systemUsed === native)
    .sort((a, b) => a.order - b.order);

  if (nativeSteps.length === 0) {
    return { refusal: "no-native-steps" };
  }

  // Deriving against an empty native ingredient list would retire every
  // opposite-system row the moment `deriveProjectionTx` runs — refuse rather
  // than silently drop the recipe's whole ingredient list.
  if (nativeIngredients.length === 0 && recipe.recipeIngredients.length > 0) {
    return { refusal: "no-native-ingredients" };
  }

  const structuredSteps: StructuredStep[] = nativeSteps.map((step, index) => ({
    text: step.step,
    order: index,
    ingredients: [],
  }));

  // Longest-name-first: "brown sugar" claims its step before "sugar" does.
  const sortedIngredients = [...nativeIngredients].sort(
    (a, b) => b.ingredientName.length - a.ingredientName.length
  );

  for (const ingredient of sortedIngredients) {
    let targetIndex = structuredSteps.findIndex(
      (step) => !isHeading(step) && hasNameAnchor(step.text, ingredient.ingredientName)
    );

    if (targetIndex === -1) {
      targetIndex = structuredSteps.findIndex((step) => !isHeading(step));
    }

    if (targetIndex === -1) targetIndex = 0;

    const ref: StructuredIngredientRef = {
      name: ingredient.ingredientName,
      amount: ingredient.amount,
      unit: ingredient.unit,
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
 */
export async function backfillCookSource(): Promise<CookBackfillOutcome> {
  const units: UnitsMap = await getUnits();
  const ids = await listRecipeIdsWithoutCookSource();

  const outcome: CookBackfillOutcome = {
    candidates: ids.length,
    derived: 0,
    flagged: 0,
    refused: 0,
    failed: 0,
  };

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
