import { describe, expect, it } from "vitest";

import {
  convertToSystem,
  convertToUnit,
  DENSITY_TABLE,
  deriveConversion,
  dimensionOf,
  findDensity,
  normalizeIngredientName,
} from "@norish/shared/units";

/**
 * W0 units subsystem — deterministic conversion + USDA density glue.
 *
 * Source values cited inline:
 *   - 1 US cup = 236.588 mL (US customary; the `convert` package cup).
 *   - all-purpose flour  125 g/cup   (USDA FoodData Central)
 *   - granulated sugar   200 g/cup   (USDA FoodData Central)
 *   - butter             227 g/cup → 14.2 g/tbsp (USDA FDC / 2 sticks = 226.8 g)
 *   - water              236.59 g/cup (definitional density 1.000 g/mL)
 */

describe("same-dimension conversion (via `convert`)", () => {
  it("g → oz (100 g ≈ 3.5274 oz)", () => {
    const r = convertToUnit(100, "gram", "ounce");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.via).toBe("same-dimension");
    expect(r.unit).toBe("ounce");
    expect(r.quantity).toBeCloseTo(3.5274, 3);
  });

  it("ml → cup (236.588 ml ≈ 1 cup)", () => {
    const r = convertToUnit(236.588, "milliliter", "cup");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(1, 4);
  });

  it("tsp → ml (1 tsp ≈ 4.9289 ml)", () => {
    const r = convertToUnit(1, "teaspoon", "milliliter");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(4.9289, 3);
  });

  it("°C → °F (100 °C = 212 °F)", () => {
    const r = convertToUnit(100, "celsius", "fahrenheit");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(212, 4);
  });

  it("accepts common raw-unit synonyms (g, oz)", () => {
    const r = convertToUnit(100, "g", "oz");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(3.5274, 3);
  });
});

describe("volume↔weight via USDA density table", () => {
  it("1 cup all-purpose flour ≈ 125 g (USDA 125 g/cup)", () => {
    const r = convertToUnit(1, "cup", "gram", { ingredient: "all-purpose flour" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.via).toBe("density");
    expect(r.quantity).toBeGreaterThanOrEqual(118);
    expect(r.quantity).toBeLessThanOrEqual(128);
  });

  it("bare 'flour' resolves to all-purpose (≈ 125 g/cup)", () => {
    const r = convertToUnit(1, "cup", "gram", { ingredient: "flour" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(125, 0);
  });

  it("1 cup granulated sugar ≈ 200 g (USDA 200 g/cup)", () => {
    const r = convertToUnit(1, "cup", "gram", { ingredient: "sugar" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeGreaterThanOrEqual(195);
    expect(r.quantity).toBeLessThanOrEqual(205);
  });

  it("1 cup water = 236.6 g (definitional 1.000 g/mL)", () => {
    const r = convertToUnit(1, "cup", "gram", { ingredient: "water" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(236.6, 0);
  });

  it("1 tbsp butter ≈ 14 g (USDA 227 g/cup → 14.2 g/tbsp)", () => {
    const r = convertToUnit(1, "tablespoon", "gram", { ingredient: "butter" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeGreaterThanOrEqual(13);
    expect(r.quantity).toBeLessThanOrEqual(15);
  });

  it("longest-match wins: 'brown sugar' (220) ≠ 'sugar' (200)", () => {
    const brown = convertToUnit(1, "cup", "gram", { ingredient: "brown sugar" });
    const white = convertToUnit(1, "cup", "gram", { ingredient: "sugar" });

    expect(brown.ok && white.ok).toBe(true);
    if (!brown.ok || !white.ok) return;
    expect(brown.quantity).toBeGreaterThan(white.quantity);
    expect(brown.quantity).toBeCloseTo(220, 0);
  });

  it("mass → volume round-trips through the same density", () => {
    // 125 g flour → cup → ~1 cup
    const r = convertToUnit(125, "gram", "cup", { ingredient: "all-purpose flour" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeCloseTo(1, 1);
  });
});

describe("flag-on-unknown — NEVER fabricate a density", () => {
  it("unknown-density ingredient returns FLAGGED, not a number", () => {
    const r = convertToUnit(1, "cup", "gram", { ingredient: "dragon fruit puree" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown-density");
    expect(r.original).toEqual({ quantity: 1, unit: "cup" });
  });

  it("volume→weight with NO ingredient name flags unknown-density", () => {
    const r = convertToUnit(1, "cup", "gram");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown-density");
  });

  it("a variant we don't stock ('coconut flour') does NOT borrow 'flour' density", () => {
    const r = convertToUnit(1, "cup", "gram", { ingredient: "coconut flour" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown-density");
  });

  it("EVERY density-backed result uses a REAL, sourced table density (never invented)", () => {
    const realDensities = new Set(DENSITY_TABLE.map((e) => e.gramsPerMilliliter));
    const names = ["flour", "sugar", "butter", "water", "milk", "honey", "olive oil", "rice"];

    for (const name of names) {
      const r = convertToUnit(1, "cup", "gram", { ingredient: name });

      if (r.ok && r.via === "density") {
        expect(r.density).toBeDefined();
        expect(realDensities.has(r.density!.gramsPerMilliliter)).toBe(true);
      }
    }
  });

  it("cross-dimension that is NOT volume↔weight is flagged not-convertible", () => {
    const r = convertToUnit(1, "gram", "centimeter");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not-convertible");
  });

  it("null / non-finite quantity flags no-quantity", () => {
    expect(convertToUnit(null, "gram", "ounce").ok).toBe(false);
    expect(convertToUnit(Number.NaN, "gram", "ounce").ok).toBe(false);
  });
});

describe("canonical-unit round-trips", () => {
  it("gram → ounce → gram preserves the value", () => {
    const there = convertToUnit(500, "gram", "ounce");

    expect(there.ok).toBe(true);
    if (!there.ok) return;
    const back = convertToUnit(there.quantity, "ounce", "gram");

    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.quantity).toBeCloseTo(500, 3);
  });

  it("cup → milliliter → cup preserves the value", () => {
    const there = convertToUnit(2, "cup", "milliliter");

    expect(there.ok).toBe(true);
    if (!there.ok) return;
    const back = convertToUnit(there.quantity, "milliliter", "cup");

    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.quantity).toBeCloseTo(2, 4);
  });

  it("identity conversion returns unchanged", () => {
    const r = convertToUnit(3, "gram", "gram");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ quantity: 3, unit: "gram", via: "identity" });
  });
});

describe("convertToSystem (metric ↔ US projection, same-dimension)", () => {
  it("500 g → US picks pound (≈ 1.1 lb)", () => {
    const r = convertToSystem(500, "gram", "us");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("pound");
    expect(r.quantity).toBeCloseTo(1.102, 2);
  });

  it("100 g → US picks ounce (< 1 lb)", () => {
    const r = convertToSystem(100, "gram", "us");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("ounce");
  });

  it("2 cups → metric picks milliliter (< 1 L)", () => {
    const r = convertToSystem(2, "cup", "metric");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("milliliter");
    expect(r.quantity).toBeCloseTo(473.18, 1);
  });

  it("5 cups → metric picks liter (≥ 1 L)", () => {
    const r = convertToSystem(5, "cup", "metric");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("liter");
  });

  it("count/descriptive unit (clove) is system-neutral, unchanged", () => {
    const r = convertToSystem(2, "clove", "us");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ quantity: 2, unit: "clove", via: "identity" });
  });

  it("length (cm) has no US canonical unit → unchanged", () => {
    const r = convertToSystem(20, "centimeter", "us");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unit).toBe("centimeter");
  });

  it("does NOT auto cross-convert volume↔weight (stays within dimension)", () => {
    const r = convertToSystem(1, "cup", "metric", { ingredient: "flour" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dimensionOf(r.unit)).toBe("volume"); // milliliter, not gram
  });
});

describe("deriveConversion unified entry", () => {
  it("routes to unit target", () => {
    const r = deriveConversion({ quantity: 100, unit: "gram" }, { unit: "ounce" });

    expect(r.ok).toBe(true);
  });

  it("routes to system target", () => {
    const r = deriveConversion({ quantity: 500, unit: "gram" }, { system: "us" });

    expect(r.ok && r.unit).toBe("pound");
  });
});

describe("ingredient-name matching", () => {
  it("normalizes prep descriptors but keeps identity words", () => {
    expect(normalizeIngredientName("Fresh Chopped Onion")).toBe("onion");
    expect(normalizeIngredientName("Whole Wheat Flour")).toBe("whole wheat flour");
  });

  it("findDensity is conservative on unknowns", () => {
    expect(findDensity("all-purpose flour")?.id).toBe("all_purpose_flour");
    expect(findDensity("saffron threads")).toBeNull();
    expect(findDensity(null)).toBeNull();
  });
});
