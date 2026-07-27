/**
 * `resolveUnitsMap` — the single door both units readers go through (D-27-W5P-05).
 *
 * Proves the four stored-value shapes fall back to the file defaults correctly,
 * that a stored value wins per key over the file, and that a key present ONLY
 * in the file (e.g. a canonical unit added after an install was already seeded)
 * still surfaces — the assertion that closes the `syncUnits` no-op trap.
 */
import { describe, expect, it } from "vitest";

import { formatUnit, normalizeUnit } from "@norish/shared/lib/unit-localization";

import defaultUnits from "@norish/config/units.default.json";
import { resolveUnitsMap } from "@norish/config/units-config";

const defaults = defaultUnits as Record<
  string,
  {
    short: Array<{ locale: string; name: string }>;
    plural: Array<{ locale: string; name: string }>;
    alternates: string[];
  }
>;

describe("resolveUnitsMap", () => {
  it("returns the file defaults for undefined", () => {
    const resolved = resolveUnitsMap(undefined);

    expect(resolved.gram).toEqual(defaults.gram);
    expect(resolved.fluid_ounce).toEqual(defaults.fluid_ounce);
  });

  it("returns the file defaults for null", () => {
    const resolved = resolveUnitsMap(null);

    expect(resolved.gram).toEqual(defaults.gram);
  });

  it("returns the file defaults for garbage input", () => {
    expect(resolveUnitsMap("garbage")).toEqual(defaults);
    expect(resolveUnitsMap({ nonsense: 1 })).toEqual(defaults);
  });

  it("merges the current wrapper ({ units, isOverridden }) over the file defaults", () => {
    const storedGram = { short: [{ locale: "en", name: "GRAMME" }], plural: defaults.gram.plural, alternates: [] };
    const resolved = resolveUnitsMap({
      units: { gram: storedGram },
      isOverridden: false,
    });

    expect(resolved.gram).toEqual(storedGram);
    // File fills the gap: a stored map with exactly one key still yields every
    // other unit — including one added to the file AFTER this install was seeded.
    expect(resolved.fluid_ounce).toEqual(defaults.fluid_ounce);
  });

  it("merges the pre-v0.16 wrapper ({ units, isOverwritten }) the same way", () => {
    const storedCup = { ...defaults.cup, alternates: [...defaults.cup.alternates, "beker"] };
    const resolved = resolveUnitsMap({
      units: { cup: storedCup },
      isOverwritten: false,
    });

    expect(resolved.cup).toEqual(storedCup);
    expect(resolved.pint).toEqual(defaults.pint);
  });

  it("merges the bare legacy map (no wrapper at all) the same way", () => {
    const resolved = resolveUnitsMap({ gram: defaults.gram, cup: defaults.cup });

    expect(resolved.gram).toEqual(defaults.gram);
    expect(resolved.kilogram).toEqual(defaults.kilogram);
  });

  it("stored wins per key: a stored gram short form of 'GRAMME' is NOT overwritten by the file's 'g'", () => {
    const storedGram = {
      short: [{ locale: "en", name: "GRAMME" }],
      plural: defaults.gram.plural,
      alternates: defaults.gram.alternates,
    };
    const resolved = resolveUnitsMap({ units: { gram: storedGram }, isOverridden: true });

    expect(resolved.gram.short[0]?.name).toBe("GRAMME");
    // ...and the no-op-trap closure, asserted on both halves in one case:
    expect(resolved.fluid_ounce).toEqual(defaults.fluid_ounce);
  });
});

describe("resolveUnitsMap + normalizeUnit / formatUnit — the three new canonical IDs", () => {
  const resolved = resolveUnitsMap(undefined);

  it("normalizes the three new canonical unit IDs", () => {
    expect(normalizeUnit("kg", resolved)).toBe("kilogram");
    expect(normalizeUnit("fl oz", resolved)).toBe("fluid_ounce");
    expect(normalizeUnit("pint", resolved)).toBe("pint");
    expect(normalizeUnit("pt", resolved)).toBe("pint");
  });

  it("does NOT collide with the existing 'ounce' or 'bottle' alternates", () => {
    // 'ounce' already owns 'oz'/'oz.'; 'bottle' already owns 'fl'/'fl.' (Danish
    // *flaske*). `fluid_ounce` must not claim either.
    expect(normalizeUnit("oz", resolved)).toBe("ounce");
    expect(normalizeUnit("fl", resolved)).toBe("bottle");
  });

  it("formats the three new IDs with a localized label — no raw canonical ID leaks", () => {
    expect(formatUnit("fluid_ounce", "en", resolved, 2)).toBe("fluid ounces");
    expect(formatUnit("kilogram", "en", resolved)).toBe("kg");

    for (const id of ["kilogram", "fluid_ounce", "pint"]) {
      expect(formatUnit(id, "en", resolved)).not.toBe(id);
    }
  });
});
