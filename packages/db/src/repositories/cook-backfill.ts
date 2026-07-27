import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookTokensDTO, MeasurementSystem } from "@norish/shared/contracts/dto/recipe";

import { eq, inArray, isNull, sql } from "drizzle-orm";

import { db, withTransaction } from "../drizzle";
import { groceries, recipeIngredients, recipes } from "../schema";

import { deriveProjectionTx, type DeriveProjectionReport } from "./cook-projection";

/**
 * The DB write half of the live-data backfill (Phase 27, W5 — COOK-01, D-27-W5-02).
 *
 * PARSER-FREE by design: minting a `.cook` needs `escapeCookText`, the serializer,
 * the nine caps, `findCookSourceDefect` and the pooled WASM parser, none of which is
 * importable here without creating a dependency cycle (`@norish/shared-server`
 * already depends on `@norish/db`). This module takes an ALREADY-MINTED source and
 * its ALREADY-PARSED tokens and only writes rows.
 *
 * THREE RULES CARRIED FROM THE PLAN, each load-bearing:
 *
 * - D-27-W5-04 — the write touches ONLY `cook_source`, `cook_confidence` and
 *   `cook_review_needed`. It never bumps `recipes.updated_at` or `recipes.version`
 *   and emits no realtime event: a backfilled `.cook` is derived metadata, not a
 *   user edit.
 * - D-27-W5-05 — `cook_review_needed` is STICKY. `getRecipeFull` does not select it
 *   (the DTO defaults it to `false`), so the write is a SQL `OR` against the
 *   column's CURRENT value, never a plain assignment that could silently clear a
 *   flag `0041`'s lossy-merge branch already set.
 * - D-27-W5-06 — the grocery-link guard. `deriveProjectionTx`'s retirement DELETE
 *   scopes to "every row NOT in the kept ingredient id set", so a `.cook` that fails
 *   to cover an ingredient the OPPOSITE system's rows reference would silently null
 *   a `groceries.recipe_ingredient_id` (`onDelete: "set null"` raises nothing).
 *   ORDERING RULE: snapshot the at-risk ids BEFORE deriving, re-check them AFTER —
 *   reversing this order, or downgrading the throw to a log, is a data-loss defect,
 *   not a style choice.
 */

/** The natural-key contract `deriveProjectionTx` already takes — no re-parsing here. */
export interface CookBackfillWrite {
  recipeId: string;
  systemUsed: MeasurementSystem;
  cookSource: string;
  cookTokens: CookTokensDTO;
  cookConfidence: number;
  reviewNeeded: boolean;
  units: UnitsMap;
}

/**
 * Thrown when re-deriving a recipe's projection would delete a `recipe_ingredients`
 * row a `groceries` row still points at. The message carries the recipe id and the
 * COUNT of links at risk — never an ingredient name (T-27-05).
 */
export class GroceryLinkWouldBreakError extends Error {
  constructor(recipeId: string, lostLinkCount: number) {
    super(`recipe ${recipeId}: backfill would break ${lostLinkCount} shopping-list link(s)`);
    this.name = "GroceryLinkWouldBreakError";
  }
}

/**
 * Recipes with no `.cook` yet, ordered by id ascending so a partial run resumes
 * predictably. Excludes any recipe that already has one — the backfill is a
 * one-shot seeder, not a re-derive pass.
 */
export async function listRecipeIdsWithoutCookSource(): Promise<string[]> {
  const rows = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(isNull(recipes.cookSource))
    .orderBy(recipes.id);

  return rows.map((row) => row.id);
}

/**
 * Writes one recipe's `.cook`, confidence and sticky review flag in the SAME
 * transaction as its re-derived projection. Opens its OWN transaction — the caller
 * (the boot-time runner) calls this once per recipe, so one recipe's failure never
 * aborts another's.
 */
export async function applyCookBackfill(write: CookBackfillWrite): Promise<DeriveProjectionReport> {
  const { recipeId, systemUsed, cookSource, cookTokens, cookConfidence, reviewNeeded, units } = write;

  return withTransaction(async (tx) => {
    // 1. Snapshot the shopping-list links at risk BEFORE deriving.
    const atRisk = await tx
      .selectDistinct({ id: recipeIngredients.id })
      .from(recipeIngredients)
      .innerJoin(groceries, eq(groceries.recipeIngredientId, recipeIngredients.id))
      .where(eq(recipeIngredients.recipeId, recipeId));
    const atRiskIds = atRisk.map((row) => row.id);

    // 2. Derive the projection through the REAL projection writer.
    const report = await deriveProjectionTx(tx, { recipeId, systemUsed, cookTokens, units });

    // 3. Guard (D-27-W5-06): re-check every at-risk id survived the derive. A
    // missing id means the retirement DELETE took a row a `groceries` row points
    // at — throw to roll the WHOLE transaction back. Reversing steps 2 and 3, or
    // downgrading this to a log, is a data-loss defect.
    if (atRiskIds.length > 0) {
      const survivors = await tx
        .select({ id: recipeIngredients.id })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.id, atRiskIds));
      const survivingIds = new Set(survivors.map((row) => row.id));
      const lost = atRiskIds.filter((id) => !survivingIds.has(id));

      if (lost.length > 0) {
        throw new GroceryLinkWouldBreakError(recipeId, lost.length);
      }
    }

    // 4. Write the three cook columns only — D-27-W5-04: no `updatedAt`, no
    // `version` bump. `cookReviewNeeded` is the STICKY OR of D-27-W5-05.
    await tx
      .update(recipes)
      .set({
        cookSource,
        cookConfidence: cookConfidence.toFixed(3),
        cookReviewNeeded: sql`${recipes.cookReviewNeeded} OR ${reviewNeeded}`,
      })
      .where(eq(recipes.id, recipeId));

    return report;
  });
}
