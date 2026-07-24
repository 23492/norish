/**
 * Pure Cooklang serializer (Phase 27, W1).
 *
 * Structured norish recipe -> `.cook` string. Deterministic, locale-free and
 * dependency-free at runtime; canonical norish unit IDs are emitted verbatim as
 * the opaque `%unit` literal (D-8). The READ side (parsing `.cook` back into
 * tokens) deliberately lives in `@norish/shared-server/cooklang/parse` so the
 * WASM parser never reaches the Expo bundle.
 */
export type {
  LinkOutcome,
  SerializeResult,
  StructuredIngredientRef,
  StructuredRecipe,
  StructuredStep,
  StructuredTimerRef,
} from "./types";
export {
  formatCooklangIngredient,
  formatCooklangTimer,
  serializeWithReport,
  structuredToCooklang,
} from "./serialize";
