// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CookStepTokensSchema,
  CookTokensSchema,
  FullRecipeSchema,
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
});
