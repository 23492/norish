import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";
import type { StructuredRecipe } from "@norish/shared/cooklang";

import { structuredToCooklang } from "@norish/shared/cooklang";

import { parserLogger as log } from "../logger";

import { checkCookSourceLimits, checkStructuredRecipeLimits, findCookSourceDefect } from "./limits";
import { parseCookSource } from "./parse";

/**
 * A minted `.cook` and the tokens it parses back to.
 *
 * `buildCookPayload`'s return type, named so consumers that cannot import
 * `@norish/api` (notably `@norish/queue`) can still name the value they carry
 * (D-27-W3-02). Structurally identical to `@norish/db`'s `RecipeCookPayload`,
 * which is what it is ultimately handed to.
 */
export interface CookPayload {
  cookSource: string;
  cookTokens: CookTokensDTO;
}

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
export async function buildCookPayload(
  recipe: StructuredRecipe,
  units?: UnitsMap
): Promise<CookPayload | null> {
  const stepCount = recipe.steps?.length ?? 0;
  const ingredientCount = (recipe.steps ?? []).reduce(
    (total, step) => total + (step.ingredients?.length ?? 0),
    0
  );

  // T-27-01, gate 1 of 2: refuse an oversize recipe BEFORE serializing it, so the
  // WASM parser is never reached with something unbounded. REJECT, never truncate.
  const structuredBreach = checkStructuredRecipeLimits(recipe);

  if (structuredBreach) {
    log.error(
      {
        module: "cooklang",
        reason: "input-too-large",
        limit: structuredBreach.limit,
        measured: structuredBreach.measured,
        allowed: structuredBreach.allowed,
        stepCount,
        ingredientCount,
      },
      "Structured recipe exceeds an input-size cap; keeping the legacy projection"
    );

    return null;
  }

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

  // T-27-01, gate 2 of 2: the serialized bytes are what the parser actually sees, and
  // token syntax makes them larger than any input measurement can predict. Checked
  // here as well as inside `parseCookSource` so the ERROR-level log (and the null)
  // are attributable to the minting path rather than the read path.
  const sourceBreach = checkCookSourceLimits(cookSource);

  if (sourceBreach) {
    log.error(
      {
        module: "cooklang",
        reason: "input-too-large",
        limit: sourceBreach.limit,
        measured: sourceBreach.measured,
        allowed: sourceBreach.allowed,
        stepCount,
        ingredientCount,
      },
      "Serialized Cooklang exceeds the input-size cap; keeping the legacy projection"
    );

    return null;
  }

  // T-27-01, gate 3 of 3: the serializer escapes every Cooklang metacharacter in
  // untrusted text, so its output contains exactly the tokens it intended. THIS is
  // the assertion of that invariant — and the reason parse time is bounded, since
  // the parser is slow only when it renders diagnostics. Failing here means the
  // SERIALIZER regressed, so it is an error-level event, not a user-input event.
  const defect = findCookSourceDefect(cookSource);

  if (defect) {
    log.error(
      {
        module: "cooklang",
        reason: "not-serializer-shaped",
        defect: defect.defect,
        offset: defect.offset,
        stepCount,
        ingredientCount,
      },
      "Serialized Cooklang is not well-formed serializer output; keeping the legacy projection"
    );

    return null;
  }

  const cookTokens = await parseCookSource(cookSource, units);

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

/**
 * RE-PROVE AN ALREADY-STORED `.cook` BEFORE IT IS WRITTEN INTO A NEW ROW
 * (Phase 27, W3B — T-27-07).
 *
 * WHY THIS EXISTS. `copyRecipeForSave` used to carry `cookSource` AND `cookTokens`
 * verbatim off the source `FullRecipeDTO` straight into `createRecipeWithRefs` —
 * no re-parse, no byte cap, no `findCookSourceDefect`, no bound. It trusted the
 * source row completely, which made "a non-NULL `cook_source` always parses
 * cleanly" a claim about history rather than an invariant.
 *
 * It was LATENT, not live: its only caller's `source` comes from `getRecipeFull`,
 * which populates `cookSource` but never `cookTokens`, so `cook` was always
 * `undefined` and the copy landed with `cook_source = NULL`. That is a hole waiting
 * for the first change that populates `cookTokens` on that path — which is exactly
 * what W4 does — and W5's backfill will additionally write `cook_source` in bulk.
 *
 * SO A COPY'S `.cook` IS NOW EITHER FRESHLY PROVEN OR NULL. This runs the stored
 * source back through `parseCookSource`, i.e. through the byte cap, the recognizer
 * AND the resource bound, and returns the tokens IT produced rather than the ones
 * it was handed. A source that no longer parses is dropped, and the copy lands with
 * `cook_source = NULL` and a full legacy projection — the copy still SUCCEEDS.
 *
 * `@norish/db` STAYS PARSER-FREE. This deliberately lives here, not in the
 * repository: `copyRecipeForSave` now REQUIRES its caller to hand in an
 * already-proven pair (or `null`), and the required parameter is what makes
 * forgetting it a type error instead of a silent carry-across.
 */
export async function revalidateCookPayload(
  cookSource: string | null | undefined,
  units?: UnitsMap
): Promise<CookPayload | null> {
  if (typeof cookSource !== "string" || cookSource === "") return null;

  const cookTokens = await parseCookSource(cookSource, units);

  if (!cookTokens) {
    // Counts only, never the source (T-27-05). WARN, not ERROR: on a copy this is
    // an old or externally-written row, not evidence that the serializer regressed.
    log.warn(
      {
        module: "cooklang",
        reason: "stored-source-did-not-revalidate",
        bytes: Buffer.byteLength(cookSource, "utf8"),
      },
      "Stored cook_source did not re-prove; copying with cook_source NULL"
    );

    return null;
  }

  return { cookSource, cookTokens };
}
