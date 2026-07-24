import type { UnitDimension } from "./types";

/**
 * Maps norish canonical unit IDs (`packages/config/src/units.default.json`) onto
 * the `convert` package's unit vocabulary + a physical dimension.
 *
 * Only the DIMENSIONAL units (mass/volume/length/temperature) that `convert` can
 * handle deterministically appear here. Every other canonical unit (piece, clove,
 * pinch, can, slice, heaping_tablespoon, …) is treated as `count` — a
 * descriptive/system-neutral unit that is never numerically converted (it means
 * the same thing in metric and US).
 *
 * `convert` (v7) accepts these short symbols; verified at build time (W0).
 */
interface UnitDef {
  /** The unit symbol understood by the `convert` package. */
  convertUnit: string;
  dimension: Exclude<UnitDimension, "count">;
}

export const CANONICAL_UNIT_MAP: Readonly<Record<string, UnitDef>> = {
  // ── mass ──
  gram: { convertUnit: "g", dimension: "mass" },
  ounce: { convertUnit: "oz", dimension: "mass" },
  pound: { convertUnit: "lb", dimension: "mass" },
  // ── volume ──
  milliliter: { convertUnit: "ml", dimension: "volume" },
  centiliter: { convertUnit: "cl", dimension: "volume" },
  deciliter: { convertUnit: "dl", dimension: "volume" },
  liter: { convertUnit: "l", dimension: "volume" },
  teaspoon: { convertUnit: "tsp", dimension: "volume" },
  tablespoon: { convertUnit: "tbsp", dimension: "volume" },
  cup: { convertUnit: "cup", dimension: "volume" },
  // ── length ──
  centimeter: { convertUnit: "cm", dimension: "length" },
  // ── temperature (not an ingredient unit, but supported for step-level °C↔°F) ──
  celsius: { convertUnit: "celsius", dimension: "temperature" },
  fahrenheit: { convertUnit: "fahrenheit", dimension: "temperature" },
};

/**
 * A small set of common raw-unit synonyms → canonical unit ID, so the module is
 * robust when handed a not-yet-normalized unit. Callers that already hold a
 * canonical ID (the `.cook` `%unit` per D-8) pass straight through. This is
 * deliberately conservative — the authoritative normalizer is `normalizeUnit`
 * (config-driven) in `@norish/shared/lib/unit-localization`.
 */
const UNIT_SYNONYMS: Readonly<Record<string, string>> = {
  g: "gram",
  gr: "gram",
  gram: "gram",
  grams: "gram",
  gramme: "gram",
  grammes: "gram",
  oz: "ounce",
  ounce: "ounce",
  ounces: "ounce",
  lb: "pound",
  lbs: "pound",
  pound: "pound",
  pounds: "pound",
  ml: "milliliter",
  milliliter: "milliliter",
  milliliters: "milliliter",
  millilitre: "milliliter",
  millilitres: "milliliter",
  cl: "centiliter",
  centiliter: "centiliter",
  dl: "deciliter",
  deciliter: "deciliter",
  l: "liter",
  liter: "liter",
  liters: "liter",
  litre: "liter",
  litres: "liter",
  tsp: "teaspoon",
  teaspoon: "teaspoon",
  teaspoons: "teaspoon",
  tbsp: "tablespoon",
  tablespoon: "tablespoon",
  tablespoons: "tablespoon",
  cup: "cup",
  cups: "cup",
  cm: "centimeter",
  centimeter: "centimeter",
  centimetre: "centimeter",
  c: "celsius",
  celsius: "celsius",
  f: "fahrenheit",
  fahrenheit: "fahrenheit",
};

/** Resolve a unit string (canonical ID or common synonym) to a canonical unit ID. */
export function resolveCanonicalUnit(unit: string): string {
  const trimmed = (unit ?? "").trim();

  if (CANONICAL_UNIT_MAP[trimmed]) return trimmed;

  const lower = trimmed.toLowerCase().replace(/\.$/, "");

  return UNIT_SYNONYMS[lower] ?? trimmed;
}

/** The dimension of a canonical unit ID, or `count` for descriptive/count units. */
export function dimensionOf(unit: string): UnitDimension {
  return CANONICAL_UNIT_MAP[resolveCanonicalUnit(unit)]?.dimension ?? "count";
}

/** The `convert`-package symbol for a canonical unit ID, or null if non-dimensional. */
export function convertSymbolOf(unit: string): string | null {
  return CANONICAL_UNIT_MAP[resolveCanonicalUnit(unit)]?.convertUnit ?? null;
}
