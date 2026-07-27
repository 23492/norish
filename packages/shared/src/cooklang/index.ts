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
export type { CookFrontmatterKey } from "./serialize";
export {
  COOK_FRONTMATTER_KEYS,
  COOK_FRONTMATTER_MAX_VALUE_CHARS,
  COOK_FRONTMATTER_NUMERIC_KEYS,
  escapeCookText,
  formatCooklangIngredient,
  formatCooklangTimer,
  hasNameAnchor,
  serializeWithReport,
  structuredToCooklang,
} from "./serialize";

/**
 * Pure Cooklang token RENDER model (Phase 27, W4). Projects the `cookTokens`
 * DTO into ordered, numbered, section-aware, servings-scaled steps that
 * both web and mobile render from. See `./render.ts` for the full contract.
 */
export type {
  CookRenderFormat,
  CookRenderIngredientToken,
  CookRenderScaleOptions,
  CookRenderStep,
  CookRenderTextToken,
  CookRenderTimer,
  CookRenderTimerToken,
  CookRenderToken,
} from "./render";
export {
  cookStepTimers,
  cookStepToMarkdown,
  cookTimerDurationMs,
  resolveCookRenderSteps,
} from "./render";
