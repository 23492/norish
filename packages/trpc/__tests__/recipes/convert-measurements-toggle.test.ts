// @vitest-environment node
/**
 * The metric/US toggle short-circuit (D-27-W2-06, <risks> R3).
 *
 * `recipes.convertMeasurements` skips the AI conversion when the target system is
 * already materialized. `deriveProjectionTx` writes BOTH systems' ingredient rows
 * but only the NATIVE system's step prose, so an ingredients-only predicate would
 * short-circuit a recipe that has no target-system prose — the user would see
 * converted ingredients beside un-converted steps.
 *
 * This becomes reachable only once a `.cook` producer exists (W3), which is exactly
 * why it is fixed now, before anyone can trip it.
 */

import { describe, expect, it } from "vitest";

import { hasTargetSystemProjection } from "../../src/routers/recipes/helpers";

function recipe(
  ingredientSystems: string[],
  stepSystems: string[]
): { recipeIngredients: { systemUsed: string }[]; steps: { systemUsed: string }[] } {
  return {
    recipeIngredients: ingredientSystems.map((systemUsed) => ({ systemUsed })),
    steps: stepSystems.map((systemUsed) => ({ systemUsed })),
  };
}

describe("convertMeasurements short-circuit (D-27-W2-06)", () => {
  it("DOES short-circuit when the target system has BOTH ingredients and steps", () => {
    // Every recipe the AI converter has already handled looks like this, so
    // today's behaviour is unchanged.
    expect(hasTargetSystemProjection(recipe(["metric", "us"], ["metric", "us"]), "us")).toBe(true);
  });

  it("does NOT short-circuit when the target system has ingredients but NO steps", () => {
    // The exact shape `deriveProjectionTx` produces: both systems' ingredient rows,
    // native-system prose only. Converting must still run.
    expect(hasTargetSystemProjection(recipe(["metric", "us"], ["metric"]), "us")).toBe(false);
  });

  it("does NOT short-circuit when the target system has steps but no ingredients", () => {
    expect(hasTargetSystemProjection(recipe(["metric"], ["metric", "us"]), "us")).toBe(false);
  });

  it("does NOT short-circuit when the target system is absent entirely", () => {
    expect(hasTargetSystemProjection(recipe(["metric"], ["metric"]), "us")).toBe(false);
  });

  it("is symmetric — the same rule applies converting back to metric", () => {
    expect(hasTargetSystemProjection(recipe(["us", "metric"], ["us"]), "metric")).toBe(false);
    expect(hasTargetSystemProjection(recipe(["us", "metric"], ["us", "metric"]), "metric")).toBe(
      true
    );
  });

  it("does not short-circuit an empty recipe", () => {
    expect(hasTargetSystemProjection(recipe([], []), "us")).toBe(false);
  });
});
