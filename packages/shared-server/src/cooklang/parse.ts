import type { UnitsMap } from "@norish/config/zod/server-config";
import type {
  CookStepTokensDTO,
  CookTokenDTO,
  CookTokensDTO,
} from "@norish/shared/contracts/dto/recipe";

import {
  CooklangParser,
  getQuantityUnit,
  getQuantityValue,
  quantity_display,
  type CooklangRecipe,
} from "@cooklang/cooklang";
import { normalizeUnit } from "@norish/shared/lib/unit-localization";

import { parserLogger as log } from "../logger";

/**
 * Server-only `.cook` -> `cookTokens` read model (Phase 27, W1).
 *
 * Lives in `@norish/shared-server` and NOT in `@norish/shared` (D-27-W1-01):
 * `@norish/shared` is bundled by `apps/mobile`, and a WASM binary must never
 * reach the Expo bundle. Clients render the plain-JSON projection this module
 * produces; only the server ever runs the parser.
 *
 * The parser hands back a `CooklangRecipe` CLASS instance whose step items carry
 * only an INDEX into `recipe.ingredients` / `recipe.timers`. This module
 * dereferences every index and projects the result into plain JSON so it can
 * cross superjson/tRPC and satisfy `CookTokensSchema`.
 */

/**
 * The WASM module is initialised on first construction; reuse one parser for the
 * whole process rather than paying that cost per request.
 */
let parserSingleton: CooklangParser | null = null;

function getParser(): CooklangParser {
  parserSingleton ??= new CooklangParser();

  return parserSingleton;
}

/** D-8: `%unit` carries a canonical norish unit ID — re-normalize on the way back in. */
function canonicalUnit(unit: string | null, units?: UnitsMap): string | null {
  if (!unit) return null;

  const normalized = units ? normalizeUnit(unit, units) : unit;

  return normalized === "" ? null : normalized;
}

function textToken(value: string): CookTokenDTO {
  return { type: "text", value };
}

/**
 * Project a parsed recipe into the plain-JSON `cookTokens` read model.
 *
 * `order` is a recipe-wide running index over non-text step content, so a client
 * can address a step without knowing about sections; the section heading it
 * belongs to travels with the step as `section`.
 */
export function toCookTokens(recipe: CooklangRecipe, units?: UnitsMap): CookTokensDTO {
  const steps: CookStepTokensDTO[] = [];
  let order = 0;

  for (const section of recipe.sections) {
    for (const content of section.content) {
      if (content.type !== "step") continue;

      const tokens: CookTokenDTO[] = [];

      for (const item of content.value.items) {
        switch (item.type) {
          case "text": {
            tokens.push(textToken(item.value));
            break;
          }
          case "ingredient": {
            const ingredient = recipe.ingredients[item.index];

            if (!ingredient) break;

            tokens.push({
              type: "ingredient",
              name: ingredient.name,
              amount: getQuantityValue(ingredient.quantity),
              unit: canonicalUnit(getQuantityUnit(ingredient.quantity), units),
            });
            break;
          }
          case "timer": {
            const timer = recipe.timers[item.index];

            if (!timer) break;

            tokens.push({
              type: "timer",
              name: timer.name ?? null,
              amount: getQuantityValue(timer.quantity),
              // a Cooklang TIME unit ("minutes"), not a norish ingredient unit —
              // deliberately NOT run through `normalizeUnit`, exactly as the
              // serializer deliberately does not normalize it on the way out.
              unit: getQuantityUnit(timer.quantity),
            });
            break;
          }
          case "cookware": {
            // Cookware has no token type in the W1 read model (W4 owns the
            // renderer); keep its name in the prose so the step still reads.
            const cookware = recipe.cookware[item.index];

            if (cookware) tokens.push(textToken(cookware.name));
            break;
          }
          case "inlineQuantity": {
            const quantity = recipe.inlineQuantities[item.index];

            if (quantity) tokens.push(textToken(quantity_display(quantity)));
            break;
          }
        }
      }

      steps.push({ order, section: section.name ?? null, tokens });
      order += 1;
    }
  }

  return steps;
}

/**
 * Parse a `.cook` source into the `cookTokens` read model.
 *
 * FAILURE MODE IS PART OF THE CONTRACT: this returns `null` and NEVER throws
 * into its caller — W2 puts it on a request path. `null` means "no trustworthy
 * read model", and the caller falls back to the legacy render path.
 *
 * `null` is returned when:
 *  - the input is not a non-blank string;
 *  - the parser throws;
 *  - the source yields no steps;
 *  - the parser emitted ANY diagnostic. norish AUTHORS every `.cook` it stores
 *    (D-3), so a diagnostic means our own writer produced something the parser
 *    did not fully understand. Rendering a partially-understood recipe is worse
 *    than falling back, and the signal is exactly what W5's confidence gate wants.
 */
export function parseCookSource(cookSource: string, units?: UnitsMap): CookTokensDTO | null {
  if (typeof cookSource !== "string" || cookSource.trim() === "") return null;

  let recipe: CooklangRecipe;
  let report: string;

  try {
    [recipe, report] = getParser().parse(cookSource);
  } catch (err) {
    log.warn({ module: "cooklang", err }, "Cooklang parse threw");

    return null;
  }

  if (typeof report === "string" && report.trim() !== "") {
    log.warn({ module: "cooklang" }, "Cooklang source did not parse cleanly");

    return null;
  }

  const tokens = toCookTokens(recipe, units);

  return tokens.length > 0 ? tokens : null;
}
