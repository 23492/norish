/**
 * Deterministic units-conversion subsystem (Phase 27, W0).
 *
 * Same-dimension conversion via the `convert` package (MIT); volume↔weight via a
 * config-as-code density table distilled from USDA FoodData Central; unknown
 * densities are FLAGGED-and-preserved, never fabricated. Pure & standalone — not
 * wired into the write path yet (that is W1+).
 */
export type {
  ConversionFlagged,
  ConversionOk,
  ConversionResult,
  ConversionVia,
  FlagReason,
  Measure,
  UnitDimension,
  UnitSystem,
} from "./types";
export { convertToSystem, convertToUnit, deriveConversion } from "./convert-measure";
export {
  CANONICAL_UNIT_MAP,
  convertSymbolOf,
  dimensionOf,
  resolveCanonicalUnit,
} from "./unit-dimensions";
export { CUP_ML, DENSITY_TABLE } from "./density-table";
export type { DensityEntry } from "./density-table";
export { findDensity, normalizeIngredientName } from "./ingredient-density";
