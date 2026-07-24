import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";

import { getUnits } from "../config/server-config-loader";
import { parserLogger as log } from "../logger";

import { parseCookSource } from "./parse";

/**
 * Attach the `cookTokens` read model to a recipe (Phase 27, COOK-01 / W2).
 *
 * Clients render the plain-JSON token projection; they never run the WASM parser
 * (that is what keeps `apps/mobile`'s Expo bundle parser-free), so the parse
 * happens exactly once here, server-side, per single-recipe read.
 *
 * SECURITY (HOUSE-06 / POLICY-01) — READ THIS BEFORE MOVING A CALL SITE.
 * This helper is a PURE PROJECTION. It takes no ctx, resolves no policy and
 * performs NO authorization: the boundary is enforced entirely by WHERE it is
 * called. It is invoked from exactly two places, and in both it sits strictly
 * AFTER the access check:
 *   - `findRecipeForViewer` (after `canAccessResource`), and
 *   - `getEditableProcedure` (after `assertRecipeAccess(..., "edit")`).
 * It must never be called from `recipes.list`, `autocomplete`, `getRandomRecipe`,
 * the dinner suggester, `getRecipeByUrl`, a share/public route or a realtime emit
 * site. Adding a token projection to an unscoped or differently-scoped path is
 * exactly how LIST-ISO-01 happened.
 *
 * FAILURE MODE (D-27-W2-04, read side): a stored `cook_source` that does not parse
 * yields `cookTokens: null` plus a WARN log, and the client falls back to the
 * legacy render path. It never throws, so a poisoned row cannot 500 a recipe page.
 */
export async function withCookTokens<T extends { id: string; cookSource: string | null }>(
  recipe: T
): Promise<T & { cookTokens: CookTokensDTO | null }> {
  if (!recipe.cookSource) {
    return { ...recipe, cookTokens: null };
  }

  const units = await getUnits();
  const cookTokens = parseCookSource(recipe.cookSource, units);

  if (!cookTokens) {
    // `buildCookPayload` refuses to STORE a source that does not round-trip, so
    // reaching this means a row predates that guarantee or was written by another
    // path. Loud enough for W5's backfill to find, quiet enough not to break a read.
    log.warn(
      { module: "cooklang", recipeId: recipe.id, reason: "stored-source-did-not-parse" },
      "Stored cook_source did not parse; falling back to the legacy render path"
    );
  }

  return { ...recipe, cookTokens };
}
