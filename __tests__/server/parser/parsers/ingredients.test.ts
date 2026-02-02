/**
 * Ingredient Parser Tests (TDD)
 *
 * Tests for parsing ingredients from JSON-LD recipe data.
 */

// @vitest-environment node
import { describe, it, expect } from "vitest";

import { parseIngredients } from "@/server/parser/parsers/ingredients";

describe("parseIngredients", () => {
  const emptyUnits = {};

  describe("basic parsing", () => {
    it("parses recipeIngredient array", () => {
      const json = {
        recipeIngredient: ["2 cups flour", "1 cup sugar"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[0].amount).toBe(2);
      expect(result.ingredients[0].ingredientName).toBe("flour");
      expect(result.ingredients[1].amount).toBe(1);
    });

    it("handles empty recipeIngredient", () => {
      const json = {
        recipeIngredient: [],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients).toHaveLength(0);
    });

    it("falls back to ingredients field", () => {
      const json = {
        ingredients: ["1 tablespoon oil"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients).toHaveLength(1);
    });
  });

  describe("grammatically correct unit forms", () => {
    it("returns plural unit when quantity > 1", () => {
      const json = {
        recipeIngredient: ["2 cups flour"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients[0].unit).toBe("cups");
    });

    it("returns singular unit when quantity = 1", () => {
      const json = {
        recipeIngredient: ["1 cup flour"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients[0].unit).toBe("cup");
    });

    it("returns singular unit when quantity < 1", () => {
      const json = {
        recipeIngredient: ["0.5 cup milk"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients[0].unit).toBe("cup");
    });

    it("returns plural for grams when quantity > 1", () => {
      const json = {
        recipeIngredient: ["450 grams flour"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.ingredients[0].unit).toBe("grams");
    });

    it("returns plural for custom units when quantity > 1", () => {
      const customUnits = {
        stuk: { short: "st", plural: "stuks", alternates: ["stuk"] },
      };
      const json = {
        recipeIngredient: ["2 stuk appel"],
      };

      const result = parseIngredients(json, customUnits);

      expect(result.ingredients[0].unit).toBe("stuks");
    });

    it("returns singular for custom units when quantity = 1", () => {
      const customUnits = {
        stuk: { short: "st", plural: "stuks", alternates: ["stuk"] },
      };
      const json = {
        recipeIngredient: ["1 stuk appel"],
      };

      const result = parseIngredients(json, customUnits);

      expect(result.ingredients[0].unit).toBe("stuk");
    });
  });

  describe("measurement system detection", () => {
    it("detects metric system for grams", () => {
      const json = {
        recipeIngredient: ["500 grams flour", "200 ml water"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.systemUsed).toBe("metric");
    });

    it("detects US system for cups", () => {
      const json = {
        recipeIngredient: ["2 cups flour", "1 tablespoon oil"],
      };

      const result = parseIngredients(json, emptyUnits);

      expect(result.systemUsed).toBe("us");
    });
  });
});
