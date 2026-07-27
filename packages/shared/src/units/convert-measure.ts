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

/** Round to a sane number of significant places to keep results deterministic.
 * Kept ONLY for the `identity` path (D-27-W5P-04): an unconverted measure gets
 * this floating-point-noise guard, never `roundQuantity`'s presentation rounding. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Presentation rounding for a CONVERTED quantity (D-27-W5P-03): 3 significant
 * digits, never fewer than 0 decimals. Applied at exactly ONE site —
 * `convertToUnit`'s `same-dimension` and `density` ok-result constructors —
 * and never to `via: "identity"` (D-27-W5P-04) or inside `convertToSystem`,
 * which returns `convertToUnit`'s result verbatim.
 *
 * Decimals, not fractions: `packages/shared/src/lib/format-amount.ts` already
 * owns amount PRESENTATION and offers both `formatAmountAsDecimal` and
 * `formatAmountAsFraction` behind a per-user `AmountDisplayMode`. Rounding to a
 * fraction here would fight a user who chose decimal mode and round twice for
 * one who chose fraction mode — the converter's job is a clean number, not a
 * display format; choosing how to draw it stays `formatAmount`'s job.
 */
export function roundQuantity(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value;

  // `Number((1234).toPrecision(3))` is `1230` — 3 significant digits would
  // silently discard a real integer digit once the value reaches 4+ integer
  // places. Round to the nearest integer instead, which never drops a digit.
  if (Math.abs(value) >= 1000) return Math.round(value);

  return Number(value.toPrecision(3));
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

      return { ok: true, quantity: roundQuantity(value), unit: to, via: "same-dimension" };
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

    // Covers BOTH cross-dimension directions (volume→mass and mass→volume) —
    // one shared ok-result constructor, so `roundQuantity` is applied once
    // regardless of which way the density crossing went.
    return {
      ok: true,
      quantity: roundQuantity(value),
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
  mass: { metric: ["kilogram", "gram"], us: ["pound", "ounce"] },
  // D-27-W5P-02: `fluid_ounce` and `pint` are real canonical units (they now
  // CONVERT instead of freezing — see `dimensionOf`/vocabulary.test.ts) but are
  // deliberately NOT in the automatic US ladder. The measured quality bar
  // (D-27-W3-07) is the AI's own US output across 35 ingredients, which used
  // `cup`/`tablespoon`/`teaspoon` and NEVER `fl oz` or `pint`. Each unit's only
  // possible window already produces the unit a US recipe actually prints:
  // `pint` (= 2 cups) could only displace `cup` at ≥ 4 cups ("5 cups of stock"
  // reads better than "2.5 pints"); `fluid_ounce` (= 2 tbsp) could only occupy
  // `[2 tbsp, 4 tbsp)` ("3 tablespoons olive oil" reads better than "1.5 fl oz").
  // Reversing this is a deliberate two-line change: add the IDs here and give
  // them a `MIN_MAGNITUDE` entry — flagged as a director decision point.
  volume: { metric: ["liter", "milliliter"], us: ["cup", "tablespoon", "teaspoon"] },
  temperature: { metric: ["celsius"], us: ["fahrenheit"] },
  // length has no US canonical unit in the norish config → left unchanged below.
};

/** Minimum value (in each candidate unit) to prefer it over the next-smaller one. */
const MIN_MAGNITUDE: Record<string, number> = {
  kilogram: 1,
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
  opts: { ingredient?: string | null } = {}
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

  // D-27-W5P-01: a US-targeted MASS with a REAL density crosses into volume —
  // one-directional (only `us`; metric never crosses, so `1 cup flour ->
  // metric` still projects to a volume) and density-gated (no entry ⇒ no
  // crossing, so `chicken breast` still projects to `pound`/`ounce`). This is
  // the mechanism that fixes `2 cup flour -> 8.81849 ounce` (D-27-W3-07): the
  // failing conversion is mass -> US, not a missing volume unit.
  const density =
    targetSystem === "us" && def.dimension === "mass" ? findDensity(opts.ingredient) : null;
  const targetDimension = density ? "volume" : def.dimension;

  const candidates = SYSTEM_TARGETS[targetDimension]?.[targetSystem];

  // No target unit for this dimension+system (e.g. length) → leave unchanged.
  if (!candidates || candidates.length === 0) {
    return { ok: true, quantity: round(quantity), unit: from, via: "identity" };
  }

  // Pick the largest candidate unit whose converted magnitude clears its
  // threshold; fall back to the smallest. Deterministic.
  let chosen = candidates[candidates.length - 1]!;

  if (density) {
    // Compute the candidate magnitudes THROUGH the density (grams -> mL ->
    // each candidate volume unit) before applying MIN_MAGNITUDE — the source
    // quantity is a mass, so converting it directly with `def.convertUnit`
    // (as the non-crossing branch below does) would target the wrong
    // dimension entirely.
    const fromSym = convertSymbolOf(from)!;
    const grams = convert(quantity, fromSym).to("g");
    const milliliters = grams / density.gramsPerMilliliter;

    for (const candidate of candidates) {
      const value = convert(milliliters, "ml").to(convertSymbolOf(candidate)!);
      const min = MIN_MAGNITUDE[candidate] ?? 0;

      if (Math.abs(value) >= min) {
        chosen = candidate;
        break;
      }
    }
  } else {
    for (const candidate of candidates) {
      const value = convert(quantity, def.convertUnit).to(convertSymbolOf(candidate)!);
      const min = MIN_MAGNITUDE[candidate] ?? 0;

      if (Math.abs(value) >= min) {
        chosen = candidate;
        break;
      }
    }
  }

  // The ingredient MUST be threaded here — without it, the crossing
  // conversion below re-derives dimension without density context and flags
  // `unknown-density` even though `findDensity` already found a real entry.
  // Return `convertToUnit`'s result verbatim: no second rounding, no re-shaping.
  return convertToUnit(quantity, from, chosen, { ingredient: opts.ingredient });
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
