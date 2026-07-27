import { describe, expect, it } from "vitest";

import {
  convertToSystem,
  convertToUnit,
  dimensionOf,
  resolveCanonicalUnit,
  roundQuantity,
} from "@norish/shared/units";

/**
 * Phase 27 W5-PREP, Deliverable 1 — the three canonical unit IDs
 * (`kilogram`, `fluid_ounce`, `pint`) and the US dry-goods volume preference
 * (D-27-W5P-01). Source figures cited inline:
 *   - `convert@7.0.2`: 1 kg = 1000 g; 1 US fl oz = 29.5735295625 mL;
 *     1 US pint = 473.176473 mL.
 *   - all-purpose flour 125 g/cup, granulated sugar 200 g/cup, grated parmesan
 *     100 g/cup, table salt 292 g/cup, olive oil 216 g/cup, white rice
 *     185 g/cup (USDA FoodData Central, `density-table.ts`).
 */

describe("the three new canonical unit IDs", () => {
  it("are dimensional now — before this task each was `count`", () => {
    expect(dimensionOf("kilogram")).toBe("mass");
    expect(dimensionOf("fluid_ounce")).toBe("volume");
    expect(dimensionOf("pint")).toBe("volume");
  });

  it("resolveCanonicalUnit maps common synonyms to the three new IDs", () => {
    expect(resolveCanonicalUnit("kg")).toBe("kilogram");
    expect(resolveCanonicalUnit("kilo")).toBe("kilogram");
    expect(resolveCanonicalUnit("kilograms")).toBe("kilogram");
    expect(resolveCanonicalUnit("fl oz")).toBe("fluid_ounce");
    expect(resolveCanonicalUnit("floz")).toBe("fluid_ounce");
    expect(resolveCanonicalUnit("fluid ounce")).toBe("fluid_ounce");
    expect(resolveCanonicalUnit("fluid ounces")).toBe("fluid_ounce");
    expect(resolveCanonicalUnit("pint")).toBe("pint");
    expect(resolveCanonicalUnit("pints")).toBe("pint");
    expect(resolveCanonicalUnit("pt")).toBe("pint");
  });

  it("round-trips within 1% relative tolerance (roundQuantity is lossy by design)", () => {
    const roundTrip = (quantity: number, unit: string, via: string) => {
      const there = convertToUnit(quantity, unit, via);

      expect(there.ok).toBe(true);
      if (!there.ok) return quantity;
      const back = convertToUnit(there.quantity, via, unit);

      expect(back.ok).toBe(true);
      if (!back.ok) return quantity;

      return back.quantity;
    };

    expect(Math.abs(roundTrip(1.5, "kilogram", "gram") - 1.5) / 1.5).toBeLessThan(0.01);
    expect(Math.abs(roundTrip(8, "fluid_ounce", "milliliter") - 8) / 8).toBeLessThan(0.01);
    expect(Math.abs(roundTrip(2, "pint", "liter") - 2) / 2).toBeLessThan(0.01);
  });

  it("exactness where exactness exists", () => {
    const r1 = convertToUnit(2, "cup", "fluid_ounce");

    expect(r1.ok).toBe(true);
    if (r1.ok) expect(Object.is(r1.quantity, 16)).toBe(true);

    const r2 = convertToUnit(1, "cup", "fluid_ounce");

    expect(r2.ok).toBe(true);
    if (r2.ok) expect(Object.is(r2.quantity, 8)).toBe(true);

    const r3 = convertToUnit(4, "cup", "pint");

    expect(r3.ok).toBe(true);
    if (r3.ok) expect(Object.is(r3.quantity, 2)).toBe(true);

    const r4 = convertToUnit(1500, "gram", "kilogram");

    expect(r4.ok).toBe(true);
    if (r4.ok) expect(Object.is(r4.quantity, 1.5)).toBe(true);
  });

  it("the un-freezing proof — before this task, `fl oz` and `pint` were system-neutral and unchanged", () => {
    // Before this task: `dimensionOf("fl oz")` was `count`, so
    // `convertToSystem(8, "fl oz", "metric")` returned `{ unit: "fl oz",
    // quantity: 8, via: "identity" }` — a US-authored measure never converted.
    const r = convertToSystem(8, "fl oz", "metric");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("milliliter");
    expect(r.quantity).toBe(237);

    const r2 = convertToSystem(1, "pint", "metric");

    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.unit).toBe("milliliter");
    expect(r2.quantity).toBe(473);
  });

  it("mass-metric reaches kilogram at >= 1000 g, and stays gram below it", () => {
    const kg = convertToSystem(1500, "gram", "metric");

    expect(kg.ok).toBe(true);
    if (kg.ok) {
      expect(kg.unit).toBe("kilogram");
      expect(kg.quantity).toBe(1.5);
    }

    const g = convertToSystem(500, "gram", "metric");

    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.unit).toBe("gram");
      expect(g.quantity).toBe(500);
    }
  });
});

describe("US dry-goods volume preference (D-27-W5P-01) — the D-27-W3-07 flagship rows", () => {
  it("250 g flour -> 2 cup (was 8.81849 ounce before this task)", () => {
    const r = convertToSystem(250, "gram", "us", { ingredient: "flour" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("cup");
    expect(r.quantity).toBe(2);
    expect(r.via).toBe("density");
  });

  it("100 g sugar -> 0.5 cup", () => {
    const r = convertToSystem(100, "gram", "us", { ingredient: "sugar" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("cup");
    expect(r.quantity).toBe(0.5);
  });

  it("50 g grated parmesan -> 0.5 cup", () => {
    const r = convertToSystem(50, "gram", "us", { ingredient: "grated parmesan" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("cup");
    expect(r.quantity).toBe(0.5);
  });

  it("300 g rice -> cup, quantity ~1.62", () => {
    const r = convertToSystem(300, "gram", "us", { ingredient: "rice" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("cup");
    expect(r.quantity).toBeCloseTo(1.62, 2);
  });

  it("every dry-cup case picks cup, NOT ounce", () => {
    for (const { grams, ingredient } of [
      { grams: 250, ingredient: "flour" },
      { grams: 100, ingredient: "sugar" },
      { grams: 50, ingredient: "grated parmesan" },
      { grams: 300, ingredient: "rice" },
    ]) {
      const r = convertToSystem(grams, "gram", "us", { ingredient });

      expect(r.ok).toBe(true);
      if (r.ok) expect(r.unit).not.toBe("ounce");
    }
  });

  it("small dry amounts fall down the volume ladder, not back to mass", () => {
    const salt = convertToSystem(5, "gram", "us", { ingredient: "salt" });

    expect(salt.ok).toBe(true);
    if (salt.ok) {
      expect(salt.unit).toBe("teaspoon");
      expect(salt.quantity).toBeCloseTo(0.822, 3);
    }

    const oil = convertToSystem(30, "gram", "us", { ingredient: "olive oil" });

    expect(oil.ok).toBe(true);
    if (oil.ok) {
      expect(oil.unit).toBe("tablespoon");
      expect(oil.quantity).toBeCloseTo(2.22, 2);
    }
  });

  it("the gate holds: no density entry means no crossing", () => {
    const noDensity = convertToSystem(500, "gram", "us", { ingredient: "chicken breast" });

    expect(noDensity.ok).toBe(true);
    if (noDensity.ok) expect(noDensity.unit).toBe("pound");

    const noIngredient = convertToSystem(500, "gram", "us");

    expect(noIngredient.ok).toBe(true);
    if (noIngredient.ok) expect(noIngredient.unit).toBe("pound");

    const smallNoIngredient = convertToSystem(100, "gram", "us");

    expect(smallNoIngredient.ok).toBe(true);
    if (smallNoIngredient.ok) expect(smallNoIngredient.unit).toBe("ounce");
  });

  it("one-directional: metric never crosses, and a volume source never crosses in either system", () => {
    const metric = convertToSystem(1, "cup", "metric", { ingredient: "flour" });

    expect(metric.ok).toBe(true);
    if (metric.ok) expect(dimensionOf(metric.unit)).toBe("volume");

    const usFromVolume = convertToSystem(2, "cup", "us", { ingredient: "flour" });

    expect(usFromVolume.ok).toBe(true);
    if (usFromVolume.ok) expect(usFromVolume.unit).toBe("cup");
  });

  it("fluid_ounce and pint are never selected automatically (D-27-W5P-02)", () => {
    for (const quantity of [0.5, 3, 8, 40, 500, 2000]) {
      const r = convertToSystem(quantity, "milliliter", "us");

      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.unit).not.toBe("fluid_ounce");
      expect(r.unit).not.toBe("pint");
    }
  });
});

describe("roundQuantity re-export is reachable from the barrel", () => {
  it("is the same function used by the converter", () => {
    expect(roundQuantity(1234)).toBe(1234);
    expect(roundQuantity(14.109585)).toBe(14.1);
  });
});
