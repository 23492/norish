/**
 * Input/output types for the pure Cooklang serializer (Phase 27, W1).
 *
 * The input mirrors what norish holds for a recipe TODAY (a flat step list plus a
 * structured ingredient list), extended with the per-step ingredient linkage the
 * extraction pass produces (D-3). Nothing here touches the DB, the network or a
 * locale — the serializer is pure by contract.
 */

export type StructuredIngredientRef = {
  /** ingredient display name, e.g. "all-purpose flour" */
  name: string;
  /** structured quantity from `recipe_ingredients.amount` (may be null: "to taste") */
  amount?: number | string | null;
  /** raw or canonical unit; normalized to a canonical norish unit ID before it is emitted */
  unit?: string | null;
};

export type StructuredTimerRef = {
  name?: string | null;
  amount: number | string;
  /** a Cooklang TIME unit ("minutes", "hours") — NOT a norish canonical ingredient unit */
  unit: string;
};

export type StructuredStep = {
  /** free-text instruction; a leading `#` marks a section heading (norish convention) */
  text: string;
  order: number;
  /** the linkage norish lacks today: which ingredients (with amounts) this step uses */
  ingredients: StructuredIngredientRef[];
  timers?: StructuredTimerRef[];
};

export type StructuredRecipe = {
  name: string;
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  totalMinutes?: number | null;
  source?: string | null;
  /** one `.cook` carries ONE unit system (D-2) — this records which one */
  systemUsed: "metric" | "us";
  steps: StructuredStep[];
};

/**
 * Per-ingredient outcome, surfaced so the W5 confidence gate can measure quality.
 *
 * `inline` = the name was found in the prose and replaced with a token;
 * `appended` = the ref had no textual anchor, so it was appended as a trailing
 * token (the honest failure mode: garnish / "season with X" where X is unnamed).
 */
export type LinkOutcome = {
  stepOrder: number;
  ingredient: string;
  placement: "inline" | "appended";
};

export type SerializeResult = {
  cook: string;
  links: LinkOutcome[];
};
