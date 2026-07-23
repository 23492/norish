import { describe, expect, it } from "vitest";

import type { DinnerCandidate } from "@norish/shared-server/recipes/dinner-suggester";
import {
  deriveSeason,
  matchesSeason,
  scoreDinnerCandidate,
  selectDinnerSuggestions,
} from "@norish/shared-server/recipes/dinner-suggester";

function candidate(overrides: Partial<DinnerCandidate> = {}): DinnerCandidate {
  return {
    id: "recipe-1",
    name: "Test Recipe",
    image: null,
    tags: [],
    householdAverageRating: null,
    householdRatingCount: 0,
    lastRatedAt: null,
    ...overrides,
  };
}

// Fixed reference dates, one per season, so the suggestions are fully deterministic.
const WINTER = new Date("2026-01-15T12:00:00.000Z");
const SPRING = new Date("2026-04-15T12:00:00.000Z");
const SUMMER = new Date("2026-07-15T12:00:00.000Z");
const AUTUMN = new Date("2026-10-15T12:00:00.000Z");

describe("dinner-suggester", () => {
  describe("deriveSeason", () => {
    it("maps months to northern-hemisphere seasons", () => {
      expect(deriveSeason(WINTER)).toBe("winter");
      expect(deriveSeason(SPRING)).toBe("spring");
      expect(deriveSeason(SUMMER)).toBe("summer");
      expect(deriveSeason(AUTUMN)).toBe("autumn");
      expect(deriveSeason(new Date("2026-12-01T00:00:00Z"))).toBe("winter");
    });
  });

  describe("matchesSeason", () => {
    it("matches English and Dutch seasonal keywords case-insensitively", () => {
      expect(matchesSeason(["BBQ", "Quick"], "summer")).toBe(true);
      expect(matchesSeason(["Salade"], "summer")).toBe(true);
      expect(matchesSeason(["Pompoensoep"], "autumn")).toBe(true); // substring "pompoen"
      expect(matchesSeason(["Stamppot"], "winter")).toBe(true);
    });

    it("does not match unrelated tags or the wrong season", () => {
      expect(matchesSeason(["Vegan", "Quick"], "winter")).toBe(false);
      expect(matchesSeason(["BBQ"], "winter")).toBe(false);
    });
  });

  describe("scoreDinnerCandidate", () => {
    it("gives a season-matching recipe a higher score than a neutral one", () => {
      const seasonal = scoreDinnerCandidate(candidate({ id: "a", tags: ["BBQ"] }), "summer", SUMMER);
      const neutral = scoreDinnerCandidate(candidate({ id: "a", tags: ["Vegan"] }), "summer", SUMMER);

      expect(seasonal).toBeGreaterThan(neutral);
    });

    it("favours highly-rated recipes and penalises poorly-rated ones", () => {
      const high = scoreDinnerCandidate(
        candidate({ id: "a", householdAverageRating: 5, householdRatingCount: 3 }),
        "summer",
        SUMMER
      );
      const low = scoreDinnerCandidate(
        candidate({ id: "a", householdAverageRating: 1, householdRatingCount: 3 }),
        "summer",
        SUMMER
      );

      expect(high).toBeGreaterThan(low);
    });

    it("boosts a recently-rated recipe over one rated long ago", () => {
      const recent = new Date(SUMMER.getTime() - 2 * 24 * 60 * 60 * 1000);
      const old = new Date(SUMMER.getTime() - 200 * 24 * 60 * 60 * 1000);
      const recentScore = scoreDinnerCandidate(
        candidate({ id: "a", householdAverageRating: 4, householdRatingCount: 1, lastRatedAt: recent }),
        "summer",
        SUMMER
      );
      const oldScore = scoreDinnerCandidate(
        candidate({ id: "a", householdAverageRating: 4, householdRatingCount: 1, lastRatedAt: old }),
        "summer",
        SUMMER
      );

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it("keeps every candidate eligible (score floor)", () => {
      const worst = scoreDinnerCandidate(
        candidate({ id: "a", householdAverageRating: 1, householdRatingCount: 0 }),
        "winter",
        WINTER
      );

      expect(worst).toBeGreaterThanOrEqual(0.05);
    });
  });

  describe("selectDinnerSuggestions", () => {
    it("returns [] for no candidates", () => {
      expect(selectDinnerSuggestions([], { now: SUMMER })).toEqual([]);
    });

    it("ranks the seasonal, highly-rated recipe first", () => {
      const candidates = [
        candidate({ id: "plain", name: "Plain", tags: ["Vegan"] }),
        candidate({
          id: "summer-hit",
          name: "Summer Hit",
          tags: ["BBQ"],
          householdAverageRating: 5,
          householdRatingCount: 4,
          lastRatedAt: new Date(SUMMER.getTime() - 1 * 24 * 60 * 60 * 1000),
        }),
      ];

      const result = selectDinnerSuggestions(candidates, { now: SUMMER, count: 2 });

      expect(result[0]?.id).toBe("summer-hit");
      expect(result[0]?.matchesSeason).toBe(true);
      expect(result[0]?.season).toBe("summer");
      expect(result).toHaveLength(2);
    });

    it("is deterministic for the same (candidates, now)", () => {
      const candidates = [
        candidate({ id: "a", tags: ["BBQ"] }),
        candidate({ id: "b", tags: ["Salade"] }),
        candidate({ id: "c", tags: ["Vegan"] }),
      ];
      const a = selectDinnerSuggestions(candidates, { now: SUMMER, count: 3 });
      const b = selectDinnerSuggestions(candidates, { now: SUMMER, count: 3 });

      expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    });

    it("respects the requested count", () => {
      const candidates = Array.from({ length: 5 }, (_, i) => candidate({ id: `r${i}` }));

      expect(selectDinnerSuggestions(candidates, { now: SUMMER, count: 2 })).toHaveLength(2);
    });
  });
});
