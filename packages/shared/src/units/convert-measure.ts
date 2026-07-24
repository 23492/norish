import type { ConversionFlagged, ConversionResult, FlagReason, UnitSystem } from "./types";

import convertLib from "convert";

import { findDensity } from "./ingredient-density";
import { CANONICAL_UNIT_MAP, convertSymbolOf, dimensionOf, resolveCanonicalUnit } from "./unit-dimensions";

/**
 * Typed wrapper over `convert`. The library's unit types are a huge literal
 * union that TS cannot narrow from our runtime canonical-ID strings; every call
 * site here passes a unit symbol we have already validated via
 * `CANONICAL_UNIT_MAP`, and `convert` returns a plain `number` for a concrete
 * (non-`"best"`) target unit. This wrapper encodes exactly that contract.
 */
const convert = convertLib as unknown as (
  value: number,
  unit: string
) => { to: (target: string) => number };

/** Round to a sane number of significant places to keep results deterministic. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function flag(reason: FlagReason, quantity: number, unit: string): ConversionFlagged {
  return { ok: false, flagged: true, reason, original: { quantity, unit } };
}

/**
 * Convert a measure to a SPECIFIC canonical target unit.
 *
 * - same-dimension (g→oz, ml→cup, °C→°F, cm→in via canonical ids) → `convert`;
 * - cross-dimension volume↔weight → density table (requires `ingredient`);
 * - anything not deterministically convertible → a FLAGGED result (never guessed).
 */
export function convertToUnit(
  quantity: number | null | undefined,
  fromUnit: string,
  toUnit: string,
  opts: { ingredient?: string | null } = {}
): ConversionResult {
  const from = resolveCanonicalUnit(fromUnit);
  const to = resolveCanonicalUnit(toUnit);

  if (quantity == null || !Number.isFinite(quantity)) {
    return flag("no-quantity", Number.NaN, from);
  }

  // Identity.
  if (from === to) {
    return { ok: true, quantity: round(quantity), unit: to, via: "identity" };
  }

  const fromSym = convertSymbolOf(from);
  const toSym = convertSymbolOf(to);

  // Both dimensional? → same-dimension or cross-dimension.
  if (fromSym && toSym) {
    const fromDim = dimensionOf(from);
    const toDim = dimensionOf(to);

    if (fromDim === toDim) {
      // Same physical dimension — fully off-the-shelf via `convert`.
      const value = convert(quantity, fromSym).to(toSym);

      return { ok: true, quantity: round(value), unit: to, via: "same-dimension" };
    }

    // Cross-dimension: only volume↔weight, and only via a real density.
    const isVolWeight =
      (fromDim === "volume" && toDim === "mass") || (fromDim === "mass" && toDim === "volume");

    if (!isVolWeight) {
      return flag("not-convertible", quantity, from);
    }

    const entry = findDensity(opts.ingredient);

    if (!entry) {
      // Density unknown → flag-and-preserve. NEVER fabricate a density.
      return flag("unknown-density", quantity, from);
    }

    let value: number;

    if (fromDim === "volume") {
      const ml = convert(quantity, fromSym).to("ml");
      const grams = ml * entry.gramsPerMilliliter;

      value = convert(grams, "g").to(toSym);
    } else {
      const grams = convert(quantity, fromSym).to("g");
      const ml = grams / entry.gramsPerMilliliter;

      value = convert(ml, "ml").to(toSym);
    }

    return {
      ok: true,
      quantity: round(value),
      unit: to,
      via: "density",
      density: { ingredientId: entry.id, gramsPerMilliliter: entry.gramsPerMilliliter },
    };
  }

  // At least one side is a descriptive/count unit → not numerically convertible.
  return flag("not-convertible", quantity, from);
}

/** Preferred canonical target units per (dimension, system), largest-first, for
 * picking a human-friendly unit while staying within units that HAVE a canonical
 * ID (so results always round-trip through `normalizeUnit`). */
const SYSTEM_TARGETS: Record<string, Record<UnitSystem, string[]>> = {
  mass: { metric: ["gram"], us: ["pound", "ounce"] },
  volume: { metric: ["liter", "milliliter"], us: ["cup", "tablespoon", "teaspoon"] },
  temperature: { metric: ["celsius"], us: ["fahrenheit"] },
  // length has no US canonical unit in the norish config → left unchanged below.
};

/** Minimum value (in each candidate unit) to prefer it over the next-smaller one. */
const MIN_MAGNITUDE: Record<string, number> = {
  liter: 1,
  gram: 0,
  pound: 1,
  ounce: 0,
  cup: 0.25,
  tablespoon: 1,
  teaspoon: 0,
};

/**
 * Convert a measure into a target unit SYSTEM (metric ↔ US), staying within the
 * same physical dimension (this is the metric/US projection; it does NOT
 * cross-convert volume↔weight — use `convertToUnit` for that).
 *
 * Descriptive/count units (piece, clove, pinch …) and units with no target in
 * the requested system (length) are system-neutral and returned unchanged
 * (`via: "identity"`).
 */
export function convertToSystem(
  quantity: number | null | undefined,
  fromUnit: string,
  targetSystem: UnitSystem,
  _opts: { ingredient?: string | null } = {}
): ConversionResult {
  const from = resolveCanonicalUnit(fromUnit);

  if (quantity == null || !Number.isFinite(quantity)) {
    return flag("no-quantity", Number.NaN, from);
  }

  const def = CANONICAL_UNIT_MAP[from];

  // Non-dimensional (count/descriptive) → system-neutral, unchanged.
  if (!def) {
    return { ok: true, quantity: round(quantity), unit: from, via: "identity" };
  }

  const candidates = SYSTEM_TARGETS[def.dimension]?.[targetSystem];

  // No target unit for this dimension+system (e.g. length) → leave unchanged.
  if (!candidates || candidates.length === 0) {
    return { ok: true, quantity: round(quantity), unit: from, via: "identity" };
  }

  // Pick the largest candidate unit whose converted magnitude clears its
  // threshold; fall back to the smallest. Deterministic.
  let chosen = candidates[candidates.length - 1]!;

  for (const candidate of candidates) {
    const value = convert(quantity, def.convertUnit).to(convertSymbolOf(candidate)!);
    const min = MIN_MAGNITUDE[candidate] ?? 0;

    if (Math.abs(value) >= min) {
      chosen = candidate;
      break;
    }
  }

  const result = convertToUnit(quantity, from, chosen);

  return result;
}

/**
 * Unified entry point: convert a measure to a specific canonical `unit` OR to a
 * `system`. Mirrors how the derive-projection pass (later waves) will call it.
 */
export function deriveConversion(
  input: { ingredient?: string | null; quantity: number | null | undefined; unit: string },
  target: { unit: string } | { system: UnitSystem }
): ConversionResult {
  if ("unit" in target) {
    return convertToUnit(input.quantity, input.unit, target.unit, { ingredient: input.ingredient });
  }

  return convertToSystem(input.quantity, input.unit, target.system, { ingredient: input.ingredient });
}
