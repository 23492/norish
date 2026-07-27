import { describe, expect, it } from "vitest";

import { convertToSystem, convertToUnit, roundQuantity } from "@norish/shared/units";

/**
 * Phase 27 W5-PREP, Deliverable 2 — `roundQuantity` (D-27-W5P-03): 3
 * significant digits, never fewer than 0 decimals, applied at exactly ONE
 * site inside `convertToUnit`. `via: "identity"` results are NEVER
 * presentation-rounded (D-27-W5P-04) — they keep the pre-existing 1e-6
 * determinism guard only.
 */

describe("roundQuantity boundaries", () => {
  it("non-finite and zero pass through unchanged", () => {
    expect(roundQuantity(0)).toBe(0);
    expect(Number.isNaN(roundQuantity(Number.NaN))).toBe(true);
    expect(roundQuantity(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it("rounds to 3 significant digits", () => {
    expect(roundQuantity(14.109585)).toBe(14.1);
    expect(roundQuantity(1.102311)).toBe(1.1);
    expect(roundQuantity(8.81849)).toBe(8.82);
    expect(roundQuantity(3.5273962)).toBe(3.53);
    expect(roundQuantity(0.529109)).toBe(0.529);
  });

  it("never zeroes a positive value, however small", () => {
    expect(roundQuantity(0.0022046)).toBe(0.0022);
    expect(roundQuantity(0.0000012)).toBe(0.0000012);
    expect(roundQuantity(1e-30)).toBe(1e-30);

    for (const exponent of [-1, -3, -6, -9, -12, -15, -18, -21, -24, -27, -30]) {
      const value = 10 ** exponent;

      expect(roundQuantity(value)).not.toBe(0);
    }
  });

  it("never discards an integer digit at or above 1000", () => {
    expect(roundQuantity(1234)).toBe(1234);
    expect(roundQuantity(1000.4)).toBe(1000);
    expect(roundQuantity(999.6)).toBe(1000);
  });

  it("restores integrality lost to floating point, without approximating", () => {
    expect(Object.is(roundQuantity(16.000000000000004), 16)).toBe(true);
    expect(roundQuantity(1000)).toBe(1000);
  });

  it("preserves sign", () => {
    expect(roundQuantity(-14.109585)).toBe(-14.1);
  });
});

describe("identity is NOT presentation-rounded (D-27-W5P-04)", () => {
  it("convertToUnit same-unit passthrough keeps the 1e-6 guard only", () => {
    const r = convertToUnit(3.14159, "gram", "gram");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.via).toBe("identity");
    expect(r.quantity).toBe(3.14159);
  });

  it("convertToSystem on a count unit is untouched", () => {
    const r = convertToSystem(2.5, "clove", "us");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.via).toBe("identity");
    expect(r.quantity).toBe(2.5);
  });
});

describe("applied exactly once", () => {
  it("convertToSystem's chosen result equals convertToUnit's result for the same unit — no re-rounding", () => {
    const system = convertToSystem(500, "gram", "us", { ingredient: "flour" });

    expect(system.ok).toBe(true);
    if (!system.ok) return;

    const unit = convertToUnit(500, "gram", system.unit, { ingredient: "flour" });

    expect(unit.ok).toBe(true);
    if (!unit.ok) return;

    expect(system.quantity).toBe(unit.quantity);
  });
});
