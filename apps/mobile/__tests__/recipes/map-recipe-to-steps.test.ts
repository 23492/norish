// Phase 27 (COOK-01) W4, T4 — mobile pairing between the recipe's legacy
// `steps` rows and its `cookTokens` render steps (D-27-W4-13). Pure module,
// no React — mobile has no render harness, so this is the whole proof for
// the mobile token wiring's DATA layer (D-27-W4-10).

import { describe, expect, it } from "vitest";

import type { FullRecipeDTO } from "@norish/shared/contracts";
import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";

import { mapRecipeToSteps } from "../../src/lib/recipes/map-recipe-to-steps";

function baseRecipe(overrides: Partial<FullRecipeDTO> = {}): FullRecipeDTO {
  return {
    id: "r1",
    name: "Test Recipe",
    servings: 4,
    systemUsed: "metric",
    steps: [],
    cookTokens: null,
    ...overrides,
  } as unknown as FullRecipeDTO;
}

function legacyStep(step: string, order: number, imageUrls: string[] = []) {
  return {
    step,
    order,
    systemUsed: "metric" as const,
    version: 1,
    images: imageUrls.map((image, i) => ({ id: `img-${order}-${i}`, image, order: i, version: 1 })),
  };
}

describe("mapRecipeToSteps (Phase 27 W4, T4)", () => {
  it("with cookTokens: null, output is IDENTICAL field-for-field to the pre-Phase-27-W4 shape", () => {
    const recipe = baseRecipe({
      steps: [
        legacyStep("Preheat the oven to 200C.", 1),
        legacyStep("Mix the batter.", 2, ["https://cdn/img.jpg"]),
      ],
    });

    const result = mapRecipeToSteps(recipe, null);

    expect(result).toEqual([
      { text: "Preheat the oven to 200C.", images: undefined },
      { text: "Mix the batter.", images: [{ image: "https://cdn/img.jpg" }] },
    ]);
    // No step carries a `cookStep` key at all on the legacy branch.
    expect(result.every((s) => !("cookStep" in s) || s.cookStep === undefined)).toBe(true);
  });

  it("pairs the Nth non-heading legacy step with the Nth token step and excludes the `# Heading` projection row entirely", () => {
    const cookTokens: CookTokensDTO = [
      {
        order: 1,
        section: "Sauce",
        tokens: [{ type: "text", value: "Simmer the sauce." }],
      },
      {
        order: 2,
        section: "Sauce",
        tokens: [{ type: "text", value: "Add the pasta." }],
      },
    ];
    const recipe = baseRecipe({
      cookTokens,
      steps: [
        legacyStep("# Sauce", 1),
        legacyStep("Simmer the sauce.", 2),
        legacyStep("Add the pasta.", 3),
      ],
    });

    const result = mapRecipeToSteps(recipe, null);

    // The legacy `# Sauce` heading row is gone — the paired cook step's own
    // `section`/`isSectionStart` is what surfaces a heading on this branch.
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("Simmer the sauce.");
    expect(result[0]!.cookStep?.section).toBe("Sauce");
    expect(result[0]!.cookStep?.isSectionStart).toBe(true);
    expect(result[1]!.text).toBe("Add the pasta.");
    expect(result[1]!.cookStep?.isSectionStart).toBe(false);
  });

  it("falls back to the legacy branch for the WHOLE recipe on a step-count mismatch (stale projection)", () => {
    const cookTokens: CookTokensDTO = [
      { order: 1, section: null, tokens: [{ type: "text", value: "Only one token step." }] },
    ];
    const recipe = baseRecipe({
      cookTokens,
      steps: [
        legacyStep("# Heading", 1),
        legacyStep("Step one.", 2),
        legacyStep("Step two.", 3),
      ],
    });

    const result = mapRecipeToSteps(recipe, null);

    // 2 non-heading legacy steps vs 1 token step -> mismatch -> full legacy
    // fallback: the heading row survives, and no step carries a cookStep.
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.text)).toEqual(["# Heading", "Step one.", "Step two."]);
    expect(result.every((s) => s.cookStep === undefined)).toBe(true);
  });

  it("scales in-step ingredient token amounts through resolveCookRenderSteps using the CURRENT servings argument", () => {
    const cookTokens: CookTokensDTO = [
      {
        order: 1,
        section: null,
        tokens: [
          { type: "text", value: "Add " },
          { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
        ],
      },
    ];
    const recipe = baseRecipe({
      servings: 4,
      cookTokens,
      steps: [legacyStep("Add 200g flour.", 1)],
    });

    const result = mapRecipeToSteps(recipe, null, 8);

    const ingredientToken = result[0]!.cookStep!.tokens.find((t) => t.type === "ingredient");
    expect(ingredientToken).toMatchObject({ amount: 400, unit: "gram" });
  });

  it("resolves image URLs the same way regardless of which branch a step takes", () => {
    const cookTokens: CookTokensDTO = [
      { order: 1, section: null, tokens: [{ type: "text", value: "Bake." }] },
    ];
    const recipe = baseRecipe({
      cookTokens,
      steps: [legacyStep("Bake.", 1, ["photo.jpg"])],
    });

    const result = mapRecipeToSteps(recipe, "https://api.example.com");

    expect(result[0]!.images).toEqual([{ image: "https://api.example.com/photo.jpg" }]);
  });
});
