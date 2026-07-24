import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";
import type { StructuredRecipe } from "@norish/shared/cooklang";

import { structuredToCooklang } from "@norish/shared/cooklang";

import { parserLogger as log } from "../logger";

import { parseCookSource } from "./parse";

/**
 * The ONLY place norish mints a `.cook` (Phase 27, COOK-01 / W2).
 *
 * Serialize a structured recipe, then IMMEDIATELY parse the result back with the
 * real WASM parser. If the round trip does not come back clean, this returns
 * `null` and the caller stores NOTHING.
 *
 * WHY THE SELF-CHECK IS THE POINT (D-27-W2-04). It buys one invariant:
 *
 *     a non-NULL `recipes.cook_source` ALWAYS parses cleanly.
 *
 * W4's token renderer and W6's `0043 NOT NULL` both stand on that. A
 * "store it anyway and hope" policy would silently poison them, and the failure
 * would only surface in front of a user months later. The loud error log below is
 * what lets W5's backfill find the gap.
 *
 * AND IT NEVER COSTS THE USER THEIR SAVE. A `null` here means the caller passes no
 * `cook` argument at all, so the legacy projection write runs exactly as it does
 * today and the write SUCCEEDS. A failed derive must never surface as a 500.
 *
 * The log carries counts and a reason but NEVER the recipe text: recipe prose is
 * per-cookbook data and must not land in a shared log stream (T-27-05).
 */
export function buildCookPayload(
  recipe: StructuredRecipe,
  units?: UnitsMap
): { cookSource: string; cookTokens: CookTokensDTO } | null {
  const stepCount = recipe.steps?.length ?? 0;
  const ingredientCount = (recipe.steps ?? []).reduce(
    (total, step) => total + (step.ingredients?.length ?? 0),
    0
  );

  let cookSource: string;

  try {
    cookSource = structuredToCooklang(recipe, units);
  } catch (err) {
    log.error(
      { module: "cooklang", stepCount, ingredientCount, reason: "serialize-threw", err },
      "Could not serialize recipe to Cooklang; keeping the legacy projection"
    );

    return null;
  }

  const cookTokens = parseCookSource(cookSource, units);

  if (!cookTokens) {
    // `parseCookSource` returns null when the parser emits ANY diagnostic, when it
    // throws, or when the source yields no steps. All three mean our own writer
    // produced something the parser did not fully understand.
    log.error(
      { module: "cooklang", stepCount, ingredientCount, reason: "did-not-parse-cleanly" },
      "Serialized Cooklang did not round-trip; keeping the legacy projection"
    );

    return null;
  }

  return { cookSource, cookTokens };
}
