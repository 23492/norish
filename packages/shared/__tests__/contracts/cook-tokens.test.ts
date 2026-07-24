// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CookStepTokensSchema,
  CookTokensSchema,
  FullRecipeInsertSchema,
  FullRecipeSchema,
  FullRecipeUpdateSchema,
  RecipeDashboardSchema,
} from "@norish/shared/contracts/zod";

const recipeId = "11111111-1111-4111-8111-111111111111";
const ingredientRowId = "22222222-2222-4222-8222-222222222222";

/** A FullRecipe payload exactly as producers build it TODAY — no cook* keys at all. */
function legacyFullRecipePayload() {
  return {
    id: recipeId,
    userId: "user-1",
    householdId: null,
    name: "Simple Pancakes",
    description: null,
    image: null,
    url: null,
    servings: 4,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    notes: null,
    systemUsed: "metric" as const,
    visibility: "private" as const,
    calories: null,
    fat: null,
    carbs: null,
    protein: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    categories: ["Breakfast" as const],
    version: 1,
    recipeIngredients: [
      {
        id: ingredientRowId,
        ingredientId: null,
        ingredientName: "flour",
        amount: 200,
        unit: "gram",
        order: 0,
        systemUsed: "metric" as const,
        version: 1,
      },
    ],
    steps: [
      {
        step: "Whisk the flour, milk, egg and salt into a smooth batter.",
        systemUsed: "metric" as const,
        order: 0,
        version: 1,
      },
    ],
  };
}

/**
 * A dashboard/list payload exactly as `listRecipes` and `dashboardRecipe` build it
 * TODAY (packages/db/src/repositories/recipes.ts) — no cook* keys at all.
 * `RecipeDashboardSchema` is derived from `createSelectSchema(recipes)`, so if
 * `0041`'s three new columns are not omitted they become REQUIRED here and the
 * recipe LIST stops parsing at runtime with no compile error (<risks> R2).
 */
function legacyDashboardPayload() {
  return {
    id: recipeId,
    userId: "user-1",
    name: "Simple Pancakes",
    description: null,
    notes: null,
    url: null,
    image: null,
    servings: 4,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    calories: null,
    categories: ["Breakfast" as const],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    version: 1,
    householdId: null,
    visibility: "private" as const,
    tags: [{ name: "quick", version: 1 }],
    averageRating: null,
    ratingCount: 0,
  };
}

/** A recipe insert payload exactly as the tRPC create input produces it today. */
function legacyRecipeInsertPayload() {
  return {
    name: "Simple Pancakes",
    servings: 4,
    systemUsed: "metric" as const,
    recipeIngredients: [
      { ingredientId: null, ingredientName: "flour", amount: 200, unit: "gram", order: 0 },
    ],
    steps: [{ step: "Whisk everything.", systemUsed: "metric" as const, order: 0 }],
  };
}

const wellFormedTokens = [
  {
    order: 0,
    section: "Dough",
    tokens: [
      { type: "text" as const, value: "Whisk the " },
      { type: "ingredient" as const, name: "flour", amount: 200, unit: "gram" },
      { type: "text" as const, value: " and rest for " },
      { type: "timer" as const, name: null, amount: 10, unit: "minutes" },
    ],
  },
  {
    order: 1,
    section: null,
    tokens: [
      { type: "text" as const, value: "Season with " },
      { type: "ingredient" as const, name: "salt", amount: null, unit: null },
    ],
  },
];

describe("CookTokens contract", () => {
  it("round-trips a well-formed cookTokens payload unchanged", () => {
    const parsed = CookTokensSchema.parse(wellFormedTokens);

    expect(parsed).toEqual(wellFormedTokens);
  });

  it("defaults `section` to null and `tokens` to an empty list", () => {
    const parsed = CookStepTokensSchema.parse({ order: 3 });

    expect(parsed).toEqual({ order: 3, section: null, tokens: [] });
  });

  it("rejects an unknown token type", () => {
    expect(() =>
      CookTokensSchema.parse([{ order: 0, tokens: [{ type: "nope", value: "x" }] }])
    ).toThrow();
  });

  it("rejects an ingredient token missing `name`", () => {
    expect(() =>
      CookTokensSchema.parse([
        { order: 0, tokens: [{ type: "ingredient", amount: 1, unit: "gram" }] },
      ])
    ).toThrow();
  });

  it("rejects a non-canonical amount type (amount must be numeric or null)", () => {
    expect(() =>
      CookTokensSchema.parse([
        { order: 0, tokens: [{ type: "ingredient", name: "flour", amount: "200", unit: "gram" }] },
      ])
    ).toThrow();
  });

  it("is plain JSON — no parser index survives and the value is structuredClone-able", () => {
    const parsed = CookTokensSchema.parse(wellFormedTokens);

    expect(() => structuredClone(parsed)).not.toThrow();
    expect(JSON.stringify(parsed)).not.toContain('"index"');

    for (const step of parsed) {
      for (const token of step.tokens) {
        expect(Object.getPrototypeOf(token)).toBe(Object.prototype);
        expect(token).not.toHaveProperty("index");
      }
    }
  });
});

describe("FullRecipeSchema backward compatibility (D-27-W1-05)", () => {
  it("parses a payload carrying NEITHER cookSource NOR cookTokens", () => {
    const parsed = FullRecipeSchema.parse(legacyFullRecipePayload());

    expect(parsed.cookSource).toBeNull();
    expect(parsed.cookTokens).toBeNull();
  });

  it("accepts an explicit cookSource + cookTokens payload", () => {
    const parsed = FullRecipeSchema.parse({
      ...legacyFullRecipePayload(),
      cookSource: "---\ntitle: Simple Pancakes\n---\nWhisk the @flour{200%gram}.\n",
      cookTokens: wellFormedTokens,
    });

    expect(parsed.cookSource).toContain("@flour{200%gram}");
    expect(parsed.cookTokens).toEqual(wellFormedTokens);
  });

  it("rejects a malformed cookTokens payload on the recipe schema", () => {
    expect(() =>
      FullRecipeSchema.parse({
        ...legacyFullRecipePayload(),
        cookTokens: [{ order: 0, tokens: [{ type: "nope" }] }],
      })
    ).toThrow();
  });

  it("defaults the `0041` columns so a payload without them still parses", () => {
    const parsed = FullRecipeSchema.parse(legacyFullRecipePayload());

    expect(parsed.cookConfidence).toBeNull();
    expect(parsed.cookReviewNeeded).toBe(false);
  });

  it("coerces a postgres `numeric` cookConfidence (which arrives as a string)", () => {
    const parsed = FullRecipeSchema.parse({
      ...legacyFullRecipePayload(),
      cookConfidence: "0.875",
      cookReviewNeeded: true,
    });

    expect(parsed.cookConfidence).toBe(0.875);
    expect(parsed.cookReviewNeeded).toBe(true);
  });
});

/**
 * <risks> R2 — the regression that would break the whole recipe list at runtime.
 * `RecipeSelectBaseSchema = createSelectSchema(recipes)`, so `0041`'s
 * `cook_source` / `cook_confidence` / `cook_review_needed` become REQUIRED keys on
 * every schema derived from it unless they are explicitly omitted. A green
 * typecheck proves nothing here — only an actual parse does.
 */
describe("RecipeDashboardSchema is unaffected by `0041` (W2, <risks> R2)", () => {
  it("parses a dashboard payload carrying NO cook* keys", () => {
    const parsed = RecipeDashboardSchema.parse(legacyDashboardPayload());

    expect(parsed.id).toBe(recipeId);
    expect(parsed.name).toBe("Simple Pancakes");
  });

  it("parses a LIST of dashboard payloads carrying NO cook* keys", () => {
    const parsed = z.array(RecipeDashboardSchema).parse([
      legacyDashboardPayload(),
      { ...legacyDashboardPayload(), id: "33333333-3333-4333-8333-333333333333" },
    ]);

    expect(parsed).toHaveLength(2);
  });

  it("exposes NO cook* key on its output — the list DTO is byte-for-byte unchanged", () => {
    const parsed = RecipeDashboardSchema.parse(legacyDashboardPayload());

    expect(parsed).not.toHaveProperty("cookSource");
    expect(parsed).not.toHaveProperty("cookTokens");
    expect(parsed).not.toHaveProperty("cookConfidence");
    expect(parsed).not.toHaveProperty("cookReviewNeeded");
  });

  it("strips a cook* key even when a producer accidentally supplies one", () => {
    const parsed = RecipeDashboardSchema.parse({
      ...legacyDashboardPayload(),
      cookSource: "Whisk the @flour{200%gram}.\n",
    });

    expect(parsed).not.toHaveProperty("cookSource");
  });
});

/**
 * D-27-W2-02 — the write input is NOT how a `.cook` enters. The insert/update
 * schemas must accept exactly what they accepted before `0041` and expose none of
 * the three new columns, so untrusted client text can never reach the WASM parser.
 */
describe("recipe write inputs reject the `0041` columns (D-27-W2-02)", () => {
  it("FullRecipeInsertSchema still accepts today's create payload", () => {
    const parsed = FullRecipeInsertSchema.parse(legacyRecipeInsertPayload());

    expect(parsed.name).toBe("Simple Pancakes");
    expect(parsed.steps).toHaveLength(1);
  });

  it("FullRecipeInsertSchema exposes no cookSource/cookConfidence/cookReviewNeeded key", () => {
    const shape = Object.keys(FullRecipeInsertSchema.shape);

    expect(shape).not.toContain("cookSource");
    expect(shape).not.toContain("cookConfidence");
    expect(shape).not.toContain("cookReviewNeeded");
  });

  it("FullRecipeInsertSchema DROPS a client-supplied cookSource instead of storing it", () => {
    const parsed = FullRecipeInsertSchema.parse({
      ...legacyRecipeInsertPayload(),
      cookSource: "Whisk the @flour{200%gram}.\n",
    });

    expect(parsed).not.toHaveProperty("cookSource");
  });

  it("FullRecipeUpdateSchema still accepts today's update payload and exposes no cook* key", () => {
    const parsed = FullRecipeUpdateSchema.parse({
      name: "Renamed",
      steps: [{ step: "Whisk everything.", systemUsed: "metric" as const, order: 0 }],
    });

    expect(parsed.name).toBe("Renamed");

    const shape = Object.keys(FullRecipeUpdateSchema.shape);

    expect(shape).not.toContain("cookSource");
    expect(shape).not.toContain("cookConfidence");
    expect(shape).not.toContain("cookReviewNeeded");
  });

  it("FullRecipeUpdateSchema DROPS a client-supplied cookSource", () => {
    const parsed = FullRecipeUpdateSchema.parse({
      name: "Renamed",
      cookSource: "Whisk the @flour{200%gram}.\n",
    });

    expect(parsed).not.toHaveProperty("cookSource");
  });
});
