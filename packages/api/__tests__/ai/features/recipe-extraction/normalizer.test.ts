/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { readFile } from "node:fs/promises";

import type { RecipeExtractionOutput } from "@norish/api/ai/schemas/recipe.schema";
import type { FullRecipeInsertDTO } from "@norish/shared/contracts/dto/recipe";
import { recipeExtractionSchema } from "@norish/api/ai/schemas/recipe.schema";
import {
  coerceExtractionSteps,
  getExtractionLogContext,
  normalizeExtractionOutput,
  validateExtractionOutput,
} from "@norish/api/ai/features/recipe-extraction/normalizer";

// Mock the normalizeExtractionOutput dependencies for isolation
vi.mock("@norish/api/parser/normalize", () => ({
  normalizeRecipeFromJson: vi.fn(),
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getUnits: vi.fn().mockResolvedValue([]),
}));

describe("validateExtractionOutput", () => {
  describe("when output is null or empty", () => {
    it("returns invalid for null output", () => {
      const result = validateExtractionOutput(null);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("AI returned empty response");
    });

    it("returns invalid for empty object", () => {
      const result = validateExtractionOutput({} as RecipeExtractionOutput);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("AI returned empty response");
    });
  });

  describe("when output is missing required fields", () => {
    it("returns invalid when name is missing", () => {
      const output = createPartialOutput({ name: undefined as unknown as string });
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Recipe extraction failed - missing required fields");
      expect(result.details?.hasName).toBe(false);
    });

    it("returns invalid when metric ingredients are missing", () => {
      const output = createPartialOutput({
        recipeIngredient: { metric: [], us: ["1 cup flour"] },
      });
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(false);
      expect(result.details?.metricIngredients).toBe(0);
      expect(result.details?.usIngredients).toBe(1);
    });

    it("returns invalid when US ingredients are missing", () => {
      const output = createPartialOutput({
        recipeIngredient: { metric: ["100g flour"], us: [] },
      });
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(false);
      expect(result.details?.metricIngredients).toBe(1);
      expect(result.details?.usIngredients).toBe(0);
    });

    it("returns invalid when metric steps are missing", () => {
      const output = createPartialOutput({
        recipeInstructions: { metric: [], us: ["Mix well"] },
      });
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(false);
      expect(result.details?.metricSteps).toBe(0);
      expect(result.details?.usSteps).toBe(1);
    });

    it("returns invalid when US steps are missing", () => {
      const output = createPartialOutput({
        recipeInstructions: { metric: ["Mix well"], us: [] },
      });
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(false);
      expect(result.details?.metricSteps).toBe(1);
      expect(result.details?.usSteps).toBe(0);
    });
  });

  describe("when output has all required fields", () => {
    it("returns valid for complete output", () => {
      const output = createValidOutput();
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.details).toEqual({
        hasName: true,
        metricIngredients: 2,
        usIngredients: 2,
        metricSteps: 2,
        usSteps: 2,
      });
    });

    it("includes correct details for single-item arrays", () => {
      const output = createPartialOutput({
        recipeIngredient: { metric: ["100g flour"], us: ["1 cup flour"] },
        recipeInstructions: { metric: ["Mix well"], us: ["Mix well"] },
      });
      const result = validateExtractionOutput(output);

      expect(result.valid).toBe(true);
      expect(result.details?.metricIngredients).toBe(1);
      expect(result.details?.usIngredients).toBe(1);
      expect(result.details?.metricSteps).toBe(1);
      expect(result.details?.usSteps).toBe(1);
    });
  });
});

describe("getExtractionLogContext", () => {
  it("returns basic context when normalized is null", () => {
    const output = createValidOutput();
    const context = getExtractionLogContext(output, null);

    expect(context).toEqual({
      recipeName: "Chocolate Cake",
      categories: null,
      metricIngredients: 2,
      usIngredients: 2,
      metricSteps: 2,
      usSteps: 2,
    });
  });

  it("includes normalized recipe details when available", () => {
    const output = createValidOutput();
    const normalized: Partial<FullRecipeInsertDTO> = {
      recipeIngredients: [
        {
          ingredientId: null,
          ingredientName: "flour",
          amount: 100,
          unit: "g",
          systemUsed: "metric",
          order: 0,
        },
        {
          ingredientId: null,
          ingredientName: "sugar",
          amount: 50,
          unit: "g",
          systemUsed: "metric",
          order: 1,
        },
        {
          ingredientId: null,
          ingredientName: "flour",
          amount: 1,
          unit: "cup",
          systemUsed: "us",
          order: 0,
        },
        {
          ingredientId: null,
          ingredientName: "sugar",
          amount: 0.5,
          unit: "cup",
          systemUsed: "us",
          order: 1,
        },
      ],
      steps: [
        { step: "Mix dry ingredients", order: 1, systemUsed: "metric", images: [] },
        { step: "Bake at 180C", order: 2, systemUsed: "metric", images: [] },
        { step: "Mix dry ingredients", order: 1, systemUsed: "us", images: [] },
        { step: "Bake at 350F", order: 2, systemUsed: "us", images: [] },
      ],
      systemUsed: "metric",
      tags: [{ name: "dessert" }, { name: "chocolate" }],
    };

    const context = getExtractionLogContext(output, normalized as FullRecipeInsertDTO);

    expect(context).toEqual({
      recipeName: "Chocolate Cake",
      categories: null,
      metricIngredients: 2,
      usIngredients: 2,
      metricSteps: 2,
      usSteps: 2,
      totalIngredients: 4,
      totalSteps: 4,
      systemUsed: "metric",
      tags: [{ name: "dessert" }, { name: "chocolate" }],
    });
  });

  it("handles missing arrays in output gracefully", () => {
    const output = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      description: null,
      recipeYield: null,
      prepTime: null,
      cookTime: null,
      totalTime: null,
      recipeIngredient: undefined,
      recipeInstructions: undefined,
      keywords: null,
      categories: null,
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    } as unknown as RecipeExtractionOutput;

    const context = getExtractionLogContext(output, null);

    expect(context).toEqual({
      recipeName: "Test Recipe",
      categories: null,
      metricIngredients: 0,
      usIngredients: 0,
      metricSteps: 0,
      usSteps: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createValidOutput(): RecipeExtractionOutput {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Chocolate Cake",
    description: "A delicious chocolate cake",
    recipeIngredient: {
      metric: ["100g flour", "50g sugar"],
      us: ["1 cup flour", "1/2 cup sugar"],
    },
    recipeInstructions: {
      metric: ["Mix dry ingredients", "Bake at 180C for 30 minutes"],
      us: ["Mix dry ingredients", "Bake at 350F for 30 minutes"],
    },
    recipeYield: "8 servings",
    cookTime: "PT30M",
    prepTime: "PT15M",
    totalTime: "PT45M",
    keywords: [],
    categories: null,
    nutrition: {
      calories: 350,
      fat: 12,
      carbs: 45,
      protein: 6,
    },
  };
}

function createPartialOutput(overrides: Partial<RecipeExtractionOutput>): RecipeExtractionOutput {
  return {
    ...createValidOutput(),
    ...overrides,
  } as RecipeExtractionOutput;
}

describe("normalizeExtractionOutput - HTML Entity Decoding", () => {
  it("keeps metric and US systems separated even when base normalizer infers US", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Mapo Tofu Udon",
      description: "Test",
      notes: null,
      recipeIngredient: {
        metric: ["300g beef mince"],
        us: ["10.6 oz beef mince"],
      },
      recipeInstructions: {
        metric: ["Cook 300g beef mince"],
        us: ["Cook 10.6 oz beef mince"],
      },
      recipeYield: "2",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: [],
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Mapo Tofu Udon",
      description: "Test",
      url: null,
      image: undefined,
      servings: 2,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [
        {
          ingredientId: null,
          ingredientName: "beef mince",
          amount: 300,
          unit: "gram",
          systemUsed: "us",
          order: 0,
        },
      ],
      steps: [{ step: "Cook 300g beef mince", order: 1, systemUsed: "us", images: [] }],
      systemUsed: "us",
      tags: [],
      images: [],
      categories: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    const metricIngredients = result?.recipeIngredients?.filter(
      (ing) => ing.systemUsed === "metric"
    );
    const usIngredients = result?.recipeIngredients?.filter((ing) => ing.systemUsed === "us");
    const metricSteps = result?.steps?.filter((step) => step.systemUsed === "metric");
    const usSteps = result?.steps?.filter((step) => step.systemUsed === "us");

    expect(metricIngredients).toHaveLength(1);
    expect(usIngredients).toHaveLength(1);
    expect(metricSteps).toHaveLength(1);
    expect(usSteps).toHaveLength(1);
  });

  it("normalizes categories with matcher", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      notes: null,
      description: "Test",
      recipeIngredient: {
        metric: ["100g flour"],
        us: ["1 cup flour"],
      },
      recipeInstructions: {
        metric: ["Mix well"],
        us: ["Mix well"],
      },
      recipeYield: "4",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: ["Brunch", "gibberish", "dinner", "Breakfast"],
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Test Recipe",
      description: "Test",
      url: null,
      image: undefined,
      servings: undefined,
      prepMinutes: undefined,
      cookMinutes: undefined,
      totalMinutes: undefined,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [],
      steps: [],
      systemUsed: "metric",
      tags: [],
      images: [],
      categories: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    expect(result?.categories).toEqual(["Breakfast", "Dinner"]);
  });

  it("decodes HTML entities in US ingredients and keeps comments", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      description: "Test",
      notes: null,
      recipeIngredient: {
        metric: ["100g flour"],
        us: ["1 cup flour &#8211; all-purpose", "2 eggs &#8211; beaten"],
      },
      recipeInstructions: {
        metric: ["Mix well"],
        us: ["Mix well"],
      },
      recipeYield: "4",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: [],
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    // Mock normalizeRecipeFromJson to return metric version
    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Test Recipe",
      description: "Test",
      url: null,
      image: undefined,
      servings: undefined,
      prepMinutes: undefined,
      cookMinutes: undefined,
      totalMinutes: undefined,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [
        {
          ingredientId: null,
          ingredientName: "flour",
          amount: 100,
          unit: "g",
          systemUsed: "metric",
          order: 0,
        },
      ],
      steps: [{ step: "Mix well", order: 1, systemUsed: "metric", images: [] }],
      systemUsed: "metric",
      tags: [],
      images: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    expect(result).toBeTruthy();
    // Check US ingredients were decoded (with &#8211;)
    const usIngredients = result?.recipeIngredients?.filter((ing) => ing.systemUsed === "us");

    expect(usIngredients).toHaveLength(2);
    expect(usIngredients?.[0].ingredientName).toContain("–"); // en dash
    expect(usIngredients?.[0].ingredientName).toContain("all-purpose"); // comment preserved
    expect(usIngredients?.[0].ingredientName).not.toContain("&#8211;");
    expect(usIngredients?.[1].ingredientName).toContain("–");
    expect(usIngredients?.[1].ingredientName).toContain("beaten");
  });

  it("decodes HTML entities in US steps and keeps full text", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      description: "Test",
      recipeIngredient: {
        metric: ["100g flour"],
        us: ["1 cup flour"],
      },
      recipeInstructions: {
        metric: ["Mix well"],
        us: [
          "Bake at 350&#176;F &#8211; use convection",
          "Cool for 10 minutes &#8211; don&#39;t rush",
        ],
      },
      recipeYield: "4",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: [],
      notes: null,
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Test Recipe",
      description: "Test",
      url: null,
      image: undefined,
      servings: undefined,
      prepMinutes: undefined,
      cookMinutes: undefined,
      totalMinutes: undefined,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [],
      steps: [{ step: "Mix well", order: 1, systemUsed: "metric", images: [] }],
      systemUsed: "metric",
      tags: [],
      images: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    const usSteps = result?.steps?.filter((s) => s.systemUsed === "us");

    expect(usSteps).toHaveLength(2);
    expect(usSteps?.[0].step).toContain("°"); // degree symbol
    expect(usSteps?.[0].step).toContain("–"); // en dash
    expect(usSteps?.[0].step).toContain("use convection"); // comment preserved
    expect(usSteps?.[0].step).not.toContain("&#176;");
    expect(usSteps?.[0].step).not.toContain("&#8211;");
    expect(usSteps?.[1].step).toContain("'"); // apostrophe
    expect(usSteps?.[1].step).toContain("don't rush");
    expect(usSteps?.[1].step).not.toContain("&#39;");
  });

  it("decodes multiple entity types in US content", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      description: "Test",
      recipeIngredient: {
        metric: ["100g flour"],
        us: ["1 cup &#8220;baker&#39;s&#8221; flour &#8211; premium grade"],
      },
      recipeInstructions: {
        metric: ["Mix"],
        us: ["It&#39;s ready when it&#8217;s smooth &#8211; about 5 minutes"],
      },
      recipeYield: "4",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: [],
      notes: null,
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Test Recipe",
      description: "Test",
      url: null,
      image: undefined,
      servings: undefined,
      prepMinutes: undefined,
      cookMinutes: undefined,
      totalMinutes: undefined,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [],
      steps: [],
      systemUsed: "metric",
      tags: [],
      images: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    const usIngredient = result?.recipeIngredients?.find((ing) => ing.systemUsed === "us");

    expect(usIngredient?.ingredientName).toContain("\u201C"); // left double quote
    expect(usIngredient?.ingredientName).toContain("'"); // apostrophe
    expect(usIngredient?.ingredientName).toContain("\u201D"); // right double quote
    expect(usIngredient?.ingredientName).toContain("–"); // en dash
    expect(usIngredient?.ingredientName).toContain("premium grade");

    const usStep = result?.steps?.find((s) => s.systemUsed === "us");

    expect(usStep?.step).toContain("'"); // apostrophe (It's)
    expect(usStep?.step).toContain("\u2019"); // right single quote (it's)
    expect(usStep?.step).toContain("–"); // en dash
    expect(usStep?.step).toContain("about 5 minutes");
  });

  it("handles US ingredients without entities", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      description: "Test",
      recipeIngredient: {
        metric: ["100g flour"],
        us: ["1 cup flour", "2 eggs"],
      },
      recipeInstructions: {
        metric: ["Mix well"],
        us: ["Mix well"],
      },
      recipeYield: "4",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: [],
      notes: null,
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Test Recipe",
      description: "Test",
      url: null,
      image: undefined,
      servings: undefined,
      prepMinutes: undefined,
      cookMinutes: undefined,
      totalMinutes: undefined,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [],
      steps: [],
      systemUsed: "metric",
      tags: [],
      images: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    const usIngredients = result?.recipeIngredients?.filter((ing) => ing.systemUsed === "us");

    expect(usIngredients).toHaveLength(2);
    // Plain text should pass through unchanged
    expect(usIngredients?.[0].ingredientName).toBe("flour");
    expect(usIngredients?.[1].ingredientName).toContain("egg");
  });

  it("maps and decodes notes from AI output", async () => {
    const output: RecipeExtractionOutput = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Test Recipe",
      description: "Test",
      notes: "Let it rest for 10 minutes &#8211; don&#39;t skip this step.",
      recipeIngredient: {
        metric: ["100g flour"],
        us: ["1 cup flour"],
      },
      recipeInstructions: {
        metric: ["Mix well"],
        us: ["Mix well"],
      },
      recipeYield: "4",
      cookTime: null,
      prepTime: null,
      totalTime: null,
      keywords: [],
      categories: [],
      nutrition: { calories: 0, fat: 0, carbs: 0, protein: 0 },
    };

    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue({
      name: "Test Recipe",
      description: "Test",
      url: null,
      image: undefined,
      servings: undefined,
      prepMinutes: undefined,
      cookMinutes: undefined,
      totalMinutes: undefined,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      recipeIngredients: [],
      steps: [],
      systemUsed: "metric",
      tags: [],
      images: [],
    } as any);

    const result = await normalizeExtractionOutput(output, { recipeId: "recipe-123" });

    expect(result?.notes).toBe("Let it rest for 10 minutes – don't skip this step.");
  });
});

describe("recipeExtractionSchema.recipeInstructions — the step union (D-27-W3-03)", () => {
  const objectStep = {
    text: "Mix the flour and sugar.",
    ingredients: [
      { name: "flour", amount: 100, unit: "g" },
      { name: "sugar", amount: "50", unit: null },
    ],
    timers: [{ name: null, amount: 10, unit: "minutes" }],
  };

  /**
   * `createValidOutput()` is shaped for `validateExtractionOutput`, not for
   * `recipeExtractionSchema.parse` — it omits `notes` and sets `categories: null`.
   * These tests exercise the PARSER, so they need a genuinely schema-valid base.
   */
  function withInstructions(metric: unknown[], us: unknown[]): unknown {
    return {
      ...createValidOutput(),
      notes: null,
      categories: ["Dinner"],
      recipeInstructions: { metric, us },
    };
  }

  it("accepts an ALL-STRINGS recipeInstructions — today's shape, exactly", () => {
    const parsed = recipeExtractionSchema.parse(
      withInstructions(["Mix dry ingredients", "Bake"], ["Mix dry ingredients", "Bake"])
    );

    expect(parsed.recipeInstructions.metric).toEqual(["Mix dry ingredients", "Bake"]);
  });

  it("accepts an ALL-OBJECTS recipeInstructions", () => {
    const parsed = recipeExtractionSchema.parse(
      withInstructions([objectStep, objectStep], [objectStep, objectStep])
    );

    expect(parsed.recipeInstructions.metric).toHaveLength(2);
    expect(coerceExtractionSteps(parsed.recipeInstructions.metric)[0]?.ingredients).toHaveLength(2);
  });

  it("accepts a MIXED recipeInstructions — a real model does this", () => {
    const parsed = recipeExtractionSchema.parse(
      withInstructions([objectStep, "Bake for 30 minutes"], ["Mix", objectStep])
    );

    const steps = coerceExtractionSteps(parsed.recipeInstructions.metric);

    expect(steps.map((step) => step.text)).toEqual([
      "Mix the flour and sugar.",
      "Bake for 30 minutes",
    ]);
    expect(steps[1]?.ingredients).toEqual([]);
  });

  it("accepts a step object with ingredients/timers OMITTED and defaults both to []", () => {
    const parsed = recipeExtractionSchema.parse(
      withInstructions([{ text: "Just prose." }], [{ text: "Just prose." }])
    );

    const [step] = coerceExtractionSteps(parsed.recipeInstructions.metric);

    expect(step).toEqual({ text: "Just prose.", ingredients: [], timers: [] });
  });

  it("returns the SAME validateExtractionOutput details counts for all three shapes", () => {
    const shapes = [
      withInstructions(["a", "b"], ["a", "b"]),
      withInstructions([objectStep, objectStep], [objectStep, objectStep]),
      withInstructions([objectStep, "b"], ["a", objectStep]),
    ];

    const details = shapes.map(
      (shape) =>
        validateExtractionOutput(recipeExtractionSchema.parse(shape) as RecipeExtractionOutput)
          .details
    );

    expect(details[0]).toEqual(details[1]);
    expect(details[1]).toEqual(details[2]);
    expect(details[0]?.metricSteps).toBe(2);
    expect(details[0]?.usSteps).toBe(2);
  });

  it("has NO .max() anywhere — a cap here would fail the whole import (T-27-01b)", async () => {
    const source = await readFile(
      new URL("../../../../src/ai/schemas/recipe.schema.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toContain(".max(");
  });
});

describe("coerceExtractionSteps is TOTAL — a bad model response can never fail an import", () => {
  it("never throws and always returns an array for degenerate input", () => {
    for (const input of [null, undefined, [], [null], [{}], [42], [[["deep"]]], "nope", 7]) {
      expect(() => coerceExtractionSteps(input)).not.toThrow();
      expect(Array.isArray(coerceExtractionSteps(input))).toBe(true);
    }

    expect(coerceExtractionSteps(null)).toEqual([]);
    expect(coerceExtractionSteps([null, 42, {}])).toEqual([]);
  });

  it("maps the string branch onto the internal shape", () => {
    expect(coerceExtractionSteps(["Mix well."])).toEqual([
      { text: "Mix well.", ingredients: [], timers: [] },
    ]);
  });

  it("drops malformed refs rather than propagating them", () => {
    const steps = coerceExtractionSteps([
      {
        text: "Mix.",
        ingredients: [{ name: "flour", amount: 1, unit: "g" }, { amount: 2 }, null, { name: "" }],
        timers: [{ name: null, amount: 5, unit: "min" }, { name: "x" }, { amount: 1, unit: "" }],
      },
    ]);

    expect(steps[0]?.ingredients).toEqual([{ name: "flour", amount: 1, unit: "g" }]);
    expect(steps[0]?.timers).toEqual([{ name: null, amount: 5, unit: "min" }]);
  });
});

describe("normalizeExtractionOutput — an all-strings extraction is byte-identical to today", () => {
  it("produces the same DTO for all-strings and for all-objects with the same text", async () => {
    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    const baseDto = (): FullRecipeInsertDTO =>
      ({
        name: "Chocolate Cake",
        systemUsed: "metric",
        recipeIngredients: [
          { ingredientId: null, ingredientName: "flour", amount: 100, unit: "g", order: 0 },
        ],
        steps: [{ step: "Mix dry ingredients", order: 1 }],
        categories: [],
        tags: [],
      }) as unknown as FullRecipeInsertDTO;

    vi.mocked(normalizeRecipeFromJson).mockImplementation(async () => baseDto());

    const strings = await normalizeExtractionOutput(
      {
        ...createValidOutput(),
        recipeInstructions: { metric: ["Mix dry ingredients"], us: ["Mix dry ingredients"] },
      },
      { recipeId: "recipe-123" }
    );

    vi.mocked(normalizeRecipeFromJson).mockImplementation(async () => baseDto());

    const objects = await normalizeExtractionOutput(
      {
        ...createValidOutput(),
        recipeInstructions: {
          metric: [{ text: "Mix dry ingredients", ingredients: [], timers: [] }],
          us: [{ text: "Mix dry ingredients", ingredients: [], timers: [] }],
        },
      } as unknown as RecipeExtractionOutput,
      { recipeId: "recipe-123" }
    );

    expect(objects).toEqual(strings);
    expect(strings?.steps).toEqual([
      { step: "Mix dry ingredients", order: 1, systemUsed: "metric" },
      { step: "Mix dry ingredients", order: 1, systemUsed: "us" },
    ]);
  });

  it("hands normalizeRecipeFromJson a plain string[] even for object steps (parseSteps is untouched)", async () => {
    const { normalizeRecipeFromJson } = await import("@norish/api/parser/normalize");

    vi.mocked(normalizeRecipeFromJson).mockResolvedValue(null);

    await normalizeExtractionOutput(
      {
        ...createValidOutput(),
        recipeInstructions: {
          metric: [{ text: "Mix it", ingredients: [{ name: "flour", amount: 1, unit: "g" }] }],
          us: ["Mix it"],
        },
      } as unknown as RecipeExtractionOutput,
      { recipeId: "recipe-123" }
    );

    const [payload] = vi.mocked(normalizeRecipeFromJson).mock.calls.at(-1) ?? [];

    expect((payload as { recipeInstructions: unknown }).recipeInstructions).toEqual(["Mix it"]);
  });
});
