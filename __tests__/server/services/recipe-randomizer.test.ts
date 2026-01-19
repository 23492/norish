import { describe, expect, it, vi } from "vitest";

import { calculateWeight, selectWeightedRandomRecipe } from "@/server/services/recipe-randomizer";

const baseCandidate = {
  id: "recipe-1",
  name: "Test Recipe",
  image: null,
  categories: [],
  householdFavoriteCount: 0,
  householdAverageRating: null as number | null,
};

describe("recipe-randomizer", () => {
  describe("calculateWeight", () => {
    it("uses base weight for no favorites or ratings", () => {
      expect(calculateWeight(baseCandidate)).toBe(1);
    });

    it("caps favorite bonus at 1.0", () => {
      const candidate = { ...baseCandidate, householdFavoriteCount: 10 };

      expect(calculateWeight(candidate)).toBe(2);
    });

    it("applies gentler rating penalty", () => {
      const candidate = { ...baseCandidate, householdAverageRating: 2 };

      expect(calculateWeight(candidate)).toBe(0.7);
    });

    it("enforces a minimum weight", () => {
      const candidate = {
        ...baseCandidate,
        householdAverageRating: 2,
        householdFavoriteCount: -10,
      };

      expect(calculateWeight(candidate)).toBe(0.1);
    });

    it("combines favorite bonus and rating penalty", () => {
      const candidate = {
        ...baseCandidate,
        householdFavoriteCount: 3,
        householdAverageRating: 2,
      };

      expect(calculateWeight(candidate)).toBeCloseTo(1.12, 5);
    });
  });

  describe("selectWeightedRandomRecipe", () => {
    it("returns null for empty candidates", () => {
      expect(selectWeightedRandomRecipe([])).toBeNull();
    });

    it("returns the only candidate when one exists", () => {
      const candidate = { ...baseCandidate };

      expect(selectWeightedRandomRecipe([candidate])).toBe(candidate);
    });

    it("selects based on weighted randomness", () => {
      const candidates = [
        { ...baseCandidate, id: "a" },
        { ...baseCandidate, id: "b", householdFavoriteCount: 3 },
        { ...baseCandidate, id: "c" },
      ];

      vi.spyOn(Math, "random").mockReturnValue(0.05);
      expect(selectWeightedRandomRecipe(candidates)?.id).toBe("a");

      vi.spyOn(Math, "random").mockReturnValue(0.65);
      expect(selectWeightedRandomRecipe(candidates)?.id).toBe("b");

      vi.spyOn(Math, "random").mockReturnValue(0.95);
      expect(selectWeightedRandomRecipe(candidates)?.id).toBe("c");
    });

    it("falls back to uniform selection when total weight is zero", () => {
      const candidates = [
        { ...baseCandidate, id: "a", householdFavoriteCount: -10 },
        { ...baseCandidate, id: "b", householdFavoriteCount: -10 },
      ];

      vi.spyOn(Math, "random").mockReturnValue(0.75);
      expect(selectWeightedRandomRecipe(candidates)?.id).toBe("b");
    });
  });
});
