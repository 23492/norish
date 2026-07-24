import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookTokensDTO, MeasurementSystem } from "@norish/shared/contracts/dto/recipe";

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { dbLogger } from "@norish/db/logger";
import { normalizeUnit } from "@norish/shared/lib/unit-localization";
import { deriveConversion } from "@norish/shared/units";

import { recipeIngredients, steps as stepsTable } from "../schema";

import { getOrCreateManyIngredientsTx } from "./ingredients";

/**
 * The derived Cooklang projection (Phase 27, COOK-01 / W2 — architecture §1.2).
 *
 * `recipes.cook_source` is the authored source of truth; `recipe_ingredients` and
 * `steps` demote to a MATERIALIZED PROJECTION of it. This module owns that
 * projection: plain token data in, rows out.
 *
 * THREE INVARIANTS, each of which is load-bearing:
 *
 * 1. **No parser here.** `@norish/shared-server` already depends on `@norish/db`,
 *    so importing `@cooklang/*` (or anything from `@norish/shared-server`) into the
 *    repository layer would be a hard dependency cycle. `deriveProjectionTx` takes
 *    an ALREADY-PARSED `CookTokensDTO`; parsing happens only in
 *    `@norish/shared-server/cooklang/{build-payload,attach-tokens}` (D-27-W2-09).
 *
 * 2. **UPSERT-stable on the natural key.** Ingredient rows are written with
 *    `ON CONFLICT (recipe_id, system_used, ingredient_id) DO UPDATE`, never
 *    delete-and-reinsert, so `recipe_ingredients.id` survives a recipe edit and
 *    `groceries.recipe_ingredient_id` survives with it (§2.5, the Phase 25 lesson).
 *    Step rows are matched POSITIONALLY and updated in place for the same reason —
 *    `steps.id` is the parent of `step_images.step_id`.
 *
 * 3. **Recipe-scoped, context-free.** Every statement carries `recipeId` in its
 *    `where`; the function takes no user id, no household id and no ctx. If it ever
 *    needs one, the design has drifted — authorization belongs at the call site.
 *
 * Both measurement systems' `recipe_ingredients` are materialized (native verbatim,
 * opposite via W0's deterministic `deriveConversion`, flag-and-preserve on failure),
 * but only the NATIVE system's `steps`: a converter can convert an amount, it cannot
 * rewrite step prose ("bake at 180 °C" -> "bake at 350 °F"). See D-27-W2-05.
 */

/** Why an ingredient could not be projected cleanly. Purely informational. */
export interface CookProjectionFlag {
  ingredient: string;
  reason: string;
}

export interface DeriveProjectionReport {
  /** Rows written for the recipe's own (native) measurement system. */
  ingredientRowsNative: number;
  /** Rows written for the opposite measurement system. */
  ingredientRowsDerived: number;
  /** Step rows written for the native system (including `#` heading rows). */
  stepRows: number;
  flagged: CookProjectionFlag[];
}

/** One intended `recipe_ingredients` row, before ingredient ids are resolved. */
interface ProjectedIngredient {
  /** Lower-cased, trimmed name — the dictionary lookup key. */
  key: string;
  /** The name as authored, handed to the ingredients dictionary. */
  name: string;
  amount: number | null;
  unit: string | null;
  order: number;
}

/** One intended `steps` row for the native system. */
interface ProjectedStep {
  order: number;
  step: string;
}

export interface CookProjection {
  native: ProjectedIngredient[];
  derived: ProjectedIngredient[];
  steps: ProjectedStep[];
  flagged: CookProjectionFlag[];
}

function oppositeSystem(system: MeasurementSystem): MeasurementSystem {
  return system === "metric" ? "us" : "metric";
}

/** D-8: `%unit` carries a canonical norish unit ID; re-normalize for belt and braces. */
function canonicalUnit(unit: string | null, units: UnitsMap): string | null {
  if (!unit) return null;

  const normalized = normalizeUnit(unit, units);

  return normalized === "" ? null : normalized;
}

/**
 * Reconstruct a step's prose from its token list.
 *
 * Ingredient/timer tokens contribute their NAME, so the prose reads the way the
 * author wrote it ("Whisk the flour and milk"); the amounts live on the projection
 * rows and, from W4, on the token renderer.
 */
function stepProse(tokens: CookTokensDTO[number]["tokens"]): string {
  return tokens.map((token) => (token.type === "text" ? token.value : (token.name ?? ""))).join("");
}

/**
 * PURE: tokens -> the intended row set for both systems.
 *
 * Deterministic — the same tokens and units always produce the same rows, which is
 * what makes the UPSERT idempotent and the whole projection re-derivable.
 */
export function computeCookProjection(params: {
  systemUsed: MeasurementSystem;
  cookTokens: CookTokensDTO;
  units: UnitsMap;
}): CookProjection {
  const { systemUsed, cookTokens, units } = params;
  const flagged: CookProjectionFlag[] = [];

  // ---- native-system ingredient rows -------------------------------------
  // One row per DISTINCT ingredient across every step, in first-appearance order.
  const byKey = new Map<string, ProjectedIngredient>();

  for (const step of cookTokens) {
    for (const token of step.tokens) {
      if (token.type !== "ingredient") continue;

      const name = token.name.trim();

      if (!name) continue;

      const key = name.toLowerCase();
      const unit = canonicalUnit(token.unit, units);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { key, name, amount: token.amount, unit, order: byKey.size });
        continue;
      }

      // The same ingredient named twice. Cooklang's recipe-level ingredient list is
      // deduped, but a `.cook` can still carry two refs with different units.
      if (existing.unit === unit && existing.amount !== null && token.amount !== null) {
        existing.amount += token.amount;
        continue;
      }

      if (existing.unit !== unit) {
        flagged.push({ ingredient: existing.name, reason: "mixed-units" });
      }

      // First occurrence wins — never guess which of two incompatible measures the
      // author meant, and never let the unique index raise on a duplicate row.
    }
  }

  const native = [...byKey.values()];

  // ---- opposite-system ingredient rows ------------------------------------
  // W0's converter, flag-and-preserve: a density is NEVER invented.
  const derived = native.map((row) => {
    const result = deriveConversion(
      { ingredient: row.name, quantity: row.amount, unit: row.unit ?? "" },
      { system: oppositeSystem(systemUsed) }
    );

    if (!result.ok) {
      flagged.push({ ingredient: row.name, reason: result.reason });

      return { ...row };
    }

    return {
      ...row,
      amount: result.quantity,
      unit: result.unit === "" ? null : result.unit,
    };
  });

  // ---- native-system step rows --------------------------------------------
  // A `== Heading ==` section becomes a `#`-prefixed step row at the boundary,
  // which is norish's in-band convention on both the read and the serialize side
  // (`packages/shared/src/cooklang/serialize.ts`), so this round-trips.
  const projectedSteps: ProjectedStep[] = [];
  let currentSection: string | null = null;

  for (const step of cookTokens) {
    if (step.section && step.section !== currentSection) {
      projectedSteps.push({ order: projectedSteps.length, step: `# ${step.section}` });
    }

    currentSection = step.section ?? null;

    const prose = stepProse(step.tokens).trim();

    if (!prose) continue;

    projectedSteps.push({ order: projectedSteps.length, step: prose });
  }

  return { native, derived, steps: projectedSteps, flagged };
}

/**
 * Write the derived projection for one recipe, inside the caller's transaction.
 *
 * `tx` is the drizzle transaction handle the caller is ALREADY inside (the same one
 * that wrote `recipes.cook_source`) — this function never opens its own transaction
 * and never touches the module-level `db`, so the `.cook` and its projection are
 * committed atomically or not at all.
 */
export async function deriveProjectionTx(
  tx: any,
  params: {
    recipeId: string;
    systemUsed: MeasurementSystem;
    cookTokens: CookTokensDTO;
    units: UnitsMap;
  }
): Promise<DeriveProjectionReport> {
  const { recipeId, systemUsed, cookTokens, units } = params;
  const derivedSystem = oppositeSystem(systemUsed);
  const projection = computeCookProjection({ systemUsed, cookTokens, units });

  // Resolve names through the shared ingredients dictionary (case-insensitive).
  const resolved =
    projection.native.length > 0
      ? await getOrCreateManyIngredientsTx(
          tx,
          projection.native.map((row) => row.name)
        )
      : [];
  const idByKey = new Map(resolved.map((ing) => [ing.name.toLowerCase().trim(), ing.id]));

  function toRow(row: ProjectedIngredient, system: MeasurementSystem) {
    const ingredientId = idByKey.get(row.key);

    if (!ingredientId) return null;

    return {
      recipeId,
      ingredientId,
      amount: row.amount,
      unit: row.unit,
      order: row.order,
      systemUsed: system,
    };
  }

  const nativeRows = projection.native
    .map((row) => toRow(row, systemUsed))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const derivedRows = projection.derived
    .map((row) => toRow(row, derivedSystem))
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const allRows = [...nativeRows, ...derivedRows];

  if (allRows.length > 0) {
    // THE KEYSTONE. `ON CONFLICT ... DO UPDATE` on the natural key preserves
    // `recipe_ingredients.id`, so `groceries.recipe_ingredient_id` survives the edit.
    // A delete-then-insert here would null every shopping-list link on every save.
    await tx
      .insert(recipeIngredients)
      .values(allRows)
      .onConflictDoUpdate({
        target: [
          recipeIngredients.recipeId,
          recipeIngredients.systemUsed,
          recipeIngredients.ingredientId,
        ],
        set: {
          amount: sql`excluded."amount"`,
          unit: sql`excluded."unit"`,
          order: sql`excluded."order"`,
          updatedAt: new Date(),
          version: sql`${recipeIngredients.version} + 1`,
        },
      });
  }

  // Retire only rows this call owns: THIS recipe, and only the two systems it just
  // wrote. Rows for an ingredient the `.cook` no longer mentions go away, which nulls
  // their grocery FK — identical to today's remove-an-ingredient behaviour.
  const keptIngredientIds = Array.from(new Set(allRows.map((row) => row.ingredientId)));
  const scope = and(
    eq(recipeIngredients.recipeId, recipeId),
    inArray(recipeIngredients.systemUsed, [systemUsed, derivedSystem])
  );

  await tx
    .delete(recipeIngredients)
    .where(
      keptIngredientIds.length > 0
        ? and(scope, notInArray(recipeIngredients.ingredientId, keptIngredientIds))
        : scope
    );

  const stepRows = await syncProjectedStepsTx(tx, recipeId, systemUsed, projection.steps);

  dbLogger.debug(
    {
      recipeId,
      systemUsed,
      ingredientRowsNative: nativeRows.length,
      ingredientRowsDerived: derivedRows.length,
      stepRows,
      flagged: projection.flagged.length,
    },
    "Derived Cooklang projection"
  );

  return {
    ingredientRowsNative: nativeRows.length,
    ingredientRowsDerived: derivedRows.length,
    stepRows,
    flagged: projection.flagged,
  };
}

/**
 * Positional in-place step sync for the NATIVE system only (D-27-W2-05).
 *
 * Mirrors `syncRecipeStepsTx`: update the i-th existing row rather than
 * delete-and-reinsert, so `steps.id` — and therefore every `step_images.step_id` —
 * survives a re-derive. Surplus rows are trimmed from the tail. Opposite-system step
 * rows are neither read nor written.
 */
async function syncProjectedStepsTx(
  tx: any,
  recipeId: string,
  systemUsed: MeasurementSystem,
  projected: ProjectedStep[]
): Promise<number> {
  const existing = await tx
    .select({ id: stepsTable.id })
    .from(stepsTable)
    .where(and(eq(stepsTable.recipeId, recipeId), eq(stepsTable.systemUsed, systemUsed)))
    .orderBy(asc(stepsTable.order));

  for (const [index, step] of projected.entries()) {
    const existingStep = existing[index];
    const values = { recipeId, step: step.step, order: index, systemUsed };

    if (existingStep) {
      await tx
        .update(stepsTable)
        .set({ ...values, version: sql`${stepsTable.version} + 1` })
        .where(eq(stepsTable.id, existingStep.id));
      continue;
    }

    await tx.insert(stepsTable).values(values);
  }

  const idsToDelete = existing.slice(projected.length).map((row: { id: string }) => row.id);

  if (idsToDelete.length > 0) {
    await tx.delete(stepsTable).where(inArray(stepsTable.id, idsToDelete));
  }

  return projected.length;
}
