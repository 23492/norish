import type { CookPayload } from "@norish/shared-server/cooklang/build-payload";
import type { FullRecipeInsertDTO } from "@norish/shared/contracts/dto/recipe";

import {
  buildStructuredRecipeFromLegacy,
  cookConfidenceFromLinks,
  COOK_REVIEW_CONFIDENCE_THRESHOLD,
} from "@norish/api/startup/backfill-cook-source";
import { getUnits } from "@norish/shared-server/config/server-config-loader";
import { buildCookPayload } from "@norish/shared-server/cooklang/build-payload";
import { parserLogger as log } from "@norish/shared-server/logger";
import { serializeWithReport } from "@norish/shared/cooklang";
import { hasRecipeName } from "@norish/shared/lib/helpers";

import { tryExtractRecipeFromJsonLd } from "./jsonld";

/**
 * The result of the JSON-LD fallback (D-27.1-04 / D-27.1-05): the
 * `FullRecipeInsertDTO` extracted from the page's structured data, plus a
 * `.cook` when the deterministic linkage earned one.
 */
export interface JsonLdFallbackResult {
  recipe: FullRecipeInsertDTO;
  cook: CookPayload | null;
}

/**
 * AI STAYS PRIMARY (D-27.1-04). This is reached ONLY after `parseRecipeFromUrl`
 * has exhausted every AI attempt (`extractWithAIPreference`, including
 * 27.1-01's retry) — it is a FALLBACK, never a bypass.
 *
 * Reuses the same extractor already in the tree (`tryExtractRecipeFromJsonLd`,
 * today reachable only behind the unset `LEGACY_RECIPE_PARSER_ROLLBACK` flag —
 * that flag's semantics are NOT resurrected; this fallback is wired explicitly)
 * and, when the linkage earns it, mints a `.cook` through W5's proven
 * deterministic seeder (`buildStructuredRecipeFromLegacy` +
 * `cookConfidenceFromLinks` + `COOK_REVIEW_CONFIDENCE_THRESHOLD`) and the ONLY
 * sanctioned minter (`buildCookPayload` — the escaping, the nine caps,
 * `findCookSourceDefect`, the pooled bounded parser are ON the path, never
 * around it).
 *
 * NEVER THROWS: the whole body runs inside one try/catch, matching the rule
 * `buildCookPayload` itself states — a failed `.cook` (or a failed extraction)
 * must never cost the user their import. Every log line carries counts,
 * reasons, ids and the url only — never a recipe name, an ingredient name or
 * step prose (T-27-05).
 */
export async function tryJsonLdFallback(
  url: string,
  html: string,
  recipeId: string
): Promise<JsonLdFallbackResult | null> {
  try {
    const recipe = await tryExtractRecipeFromJsonLd(url, html, recipeId);

    if (!hasRecipeName(recipe)) {
      log.info(
        { url, parserPath: "jsonld-fallback", outcome: "no-recipe" },
        "JSON-LD fallback: no recipe JSON-LD on this page"
      );

      return null;
    }

    const seeded = buildStructuredRecipeFromLegacy(recipe);

    if ("refusal" in seeded) {
      log.info(
        { url, parserPath: "jsonld-fallback", outcome: "seed-refused", reason: seeded.refusal },
        "JSON-LD fallback: could not seed a linkage; keeping the legacy projection"
      );

      return { recipe, cook: null };
    }

    const units = await getUnits();
    const report = serializeWithReport(seeded.structured, units);
    const confidence = cookConfidenceFromLinks(report.links);

    if (confidence < COOK_REVIEW_CONFIDENCE_THRESHOLD) {
      // `createRecipeWithRefs` takes only `{ cookSource, cookTokens }`
      // (`RecipeCookPayload`), so there is no way to write `cook_confidence` /
      // `cook_review_needed` on this path — an unflagged low-confidence `.cook`
      // would be strictly WORSE than the backfill's flagged one. `cook_source
      // NULL` is exactly what a python-scraper import produces on live today,
      // so refusing here is a no-regression degrade, not a new failure mode.
      log.info(
        {
          url,
          parserPath: "jsonld-fallback",
          outcome: "below-confidence-gate",
          confidence,
          linkCount: report.links.length,
        },
        "JSON-LD fallback: linkage confidence below the review threshold; keeping the legacy projection"
      );

      return { recipe, cook: null };
    }

    const cook = await buildCookPayload(seeded.structured, units);

    log.info(
      {
        url,
        parserPath: "jsonld-fallback",
        outcome: cook ? "minted" : "mint-refused",
        confidence,
        stepCount: seeded.structured.steps.length,
        ingredientCount: seeded.structured.steps.reduce(
          (total, step) => total + step.ingredients.length,
          0
        ),
      },
      cook ? "JSON-LD fallback: minted a cook_source" : "JSON-LD fallback: mint refused"
    );

    return { recipe, cook };
  } catch (err) {
    log.error(
      { url, parserPath: "jsonld-fallback", outcome: "threw", err },
      "JSON-LD fallback: unexpected error; degrading to no fallback"
    );

    return null;
  }
}
