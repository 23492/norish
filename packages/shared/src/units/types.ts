/**
 * Public types for the deterministic units-conversion subsystem (Phase 27, W0).
 *
 * The module converts a measure — given as a canonical unit ID (see
 * `@norish/config` `units.default.json`; e.g. `gram`, `tablespoon`, `cup`) plus a
 * quantity — into another unit or unit *system*, using:
 *   - the OSS `convert` package (MIT) for all SAME-dimension conversions
 *     (g↔oz, ml↔cup↔tsp, °C↔°F, cm↔in …), and
 *   - a config-as-code density table distilled from USDA FoodData Central for
 *     VOLUME↔WEIGHT (cup-of-flour → grams …).
 *
 * The cardinal rule (D-units, `27-DECISIONS.md`): when a conversion cannot be
 * done deterministically — most importantly when an ingredient's density is
 * unknown — the module returns a FLAGGED "not-convertible" result and NEVER
 * fabricates a value. The caller preserves the measure exactly as authored.
 */

/** The physical dimension of a unit. `count` = descriptive/countable units
 * (piece, clove, pinch, can …) that are system-neutral and never numerically
 * converted. */
export type UnitDimension = "mass" | "volume" | "length" | "temperature" | "count";

/** A measurement system, matching `MeasurementSystem` in the recipe contracts. */
export type UnitSystem = "metric" | "us";

/** A measure keyed by a canonical unit ID. */
export interface Measure {
  quantity: number;
  /** Canonical unit ID (e.g. `gram`, `cup`). */
  unit: string;
}

/** Why a conversion could not be performed deterministically. */
export type FlagReason =
  /** The unit is a descriptive/count unit (piece, clove …) or otherwise not a
   * recognized dimensional unit, so no numeric conversion is possible. */
  | "not-convertible"
  /** A volume↔weight conversion was required but the ingredient's density is not
   * in the table. Flag-and-preserve — never guessed. */
  | "unknown-density"
  /** No usable numeric quantity was supplied (e.g. null / NaN, "to taste"). */
  | "no-quantity";

/** How a successful conversion was produced (for observability / testing). */
export type ConversionVia =
  /** Source and target were already identical; returned unchanged. */
  | "identity"
  /** Same-dimension conversion via the `convert` package. */
  | "same-dimension"
  /** Cross-dimension volume↔weight via the density table. */
  | "density";

export interface ConversionOk extends Measure {
  ok: true;
  via: ConversionVia;
  /** For density conversions: the ingredient key that matched, and the g/mL used
   * (surfaced so a caller/test can audit that a real, sourced density was used). */
  density?: { ingredientId: string; gramsPerMilliliter: number };
}

export interface ConversionFlagged {
  ok: false;
  flagged: true;
  reason: FlagReason;
  /** The original measure, preserved verbatim for the caller to keep as-authored. */
  original: Measure;
}

/** The result of any conversion: a converted measure, or a flagged preservation. */
export type ConversionResult = ConversionOk | ConversionFlagged;
