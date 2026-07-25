import type { StructuredRecipe } from "@norish/shared/cooklang";

/**
 * Input-size limiting for the Cooklang pipeline (Phase 27, T-27-01 / W3).
 *
 * WHY THIS MODULE EXISTS. `@cooklang/cooklang` is a compiled Rust/WASM binary.
 * From W3 onward it is reached by text that a scraped page, an uploaded photo or
 * a video transcript steered a language model into producing — native code on the
 * far side of a prompt-injection surface. The parser is also **synchronous**:
 * once `CooklangParser.parse` is entered it cannot be cancelled, so the only
 * control available is *what and how much is allowed in*. These caps are that
 * control, and they are enforced INSIDE the two and only two doors to the parser
 * (`buildCookPayload` and `parseCookSource`), never at their call sites.
 *
 * BEHAVIOUR ON BREACH IS REJECT, NEVER TRUNCATE. A truncated `.cook` can still
 * parse cleanly, which would store a source that silently omits steps and break
 * the invariant "a non-NULL `cook_source` parses cleanly *and describes this
 * recipe*". Rejecting costs the user nothing: no `cook` argument is passed, the
 * legacy projection is written in full and the import still succeeds.
 *
 * HOW THE NUMBERS WERE CALIBRATED (raise a cap deliberately, never by guess):
 *  - the five committed serializer fixtures (`packages/shared/__tests__/cooklang/
 *    fixtures.ts`) serialize to a low single-digit KB, so `maxCookSourceBytes`
 *    (64 KiB) leaves roughly 30x headroom over the largest real fixture;
 *  - the HTML handed to the model is already truncated to 50 000 chars
 *    (`packages/api/src/ai/recipe-parser.ts`), so an extraction cannot legitimately
 *    describe more prose than that;
 *  - a real recipe has tens of steps and tens of ingredients; `maxSteps: 200` and
 *    `maxTotalIngredientRefs: 600` are one to two orders of magnitude above every
 *    fixture and every recipe observed in the Phase 27 spike.
 *
 * WHY A BYTE CAP ALONE IS NOT ENOUGH — `maxCookMalformedTokens` (measured, W3).
 * A size cap bounds how much text the parser reads; it does NOT bound how long the
 * parser takes. `@cooklang/cooklang@0.18.7` renders a DIAGNOSTIC per malformed token
 * and each diagnostic quotes the whole LINE it sits on, so report construction costs
 * O(malformed tokens x line length) and the returned report string crosses the WASM
 * boundary. Measured on this tree, all WITHIN a 64 KiB source:
 *
 *   | source (64 KiB unless stated)            | parse time | report  |
 *   |------------------------------------------|-----------:|--------:|
 *   | `("#" x 8 + " ")` x 128 + one long word  |  18 387 ms |  ~250MB |
 *   | `("~~ ")` x 2048 + one long word         |  17 462 ms |  ~134MB |
 *   | `"#" x 4096` (4 KiB source!)             |   4 553 ms |   ~17MB |
 *   | `"@" x 65536`                            |   4 281 ms |       - |
 *   | the same bytes rewrapped at 8 192/line   |     131 ms |       - |
 *
 * Lowering `maxCookSourceBytes` cannot fix this: the worst case is NON-MONOTONIC in
 * the cap (a 4 KiB `#` run already costs 4.5 s, and whether the WASM finishes or
 * traps depends on how far its linear memory has grown), so there is no byte cap
 * that is both safe and large enough for a real recipe.
 *
 * The root cause is malformed TOKENS, not size — and norish AUTHORS every `.cook` it
 * stores (D-3), so its own serializer emits exactly ZERO of them: ingredients are
 * `@name` / `@name{...}`, timers `~{...}` / `~name{...}`, section headings
 * `== Heading ==`, and `sanitizeTokenName` strips `@{}~#%` from every name. Cookware
 * (`#`) is never emitted at all. A malformed token can therefore only arrive from
 * unsanitized step PROSE — i.e. exactly the prompt-injection channel this cap exists
 * for. Capping them at 8 tolerates an incidental stray `~` or `#` in real prose while
 * refusing every pathological family; with it in force the worst surviving
 * adversarial input measures 622 ms, a 3.2x margin under the 2 000 ms budget.
 *
 * DELIBERATELY NOT A ZOD `.max()` ON THE EXTRACTION SCHEMA (T-27-01b): a cap there
 * would make an oversize extraction fail the WHOLE import. A cap at the parser door
 * costs only the `.cook`.
 */
export const COOK_LIMITS = {
  /** UTF-8 BYTES of a `.cook` source (not code units). ~30x the largest real fixture. */
  maxCookSourceBytes: 65_536,
  /** Steps in one structured recipe, section headings included. */
  maxSteps: 200,
  /** Characters of one step's prose. */
  maxStepTextChars: 4_000,
  /** Ingredient references attached to a single step. */
  maxIngredientRefsPerStep: 60,
  /** Ingredient references across the whole recipe. */
  maxTotalIngredientRefs: 600,
  /** Timer references attached to a single step. */
  maxTimersPerStep: 10,
  /** Characters of one ingredient or timer reference name. */
  maxRefNameChars: 200,
  /** Characters of one ingredient or timer unit. */
  maxUnitChars: 40,
  /** Characters of the recipe name. */
  maxRecipeNameChars: 500,
  /**
   * Cooklang token starts (`@`, `#`, `~`) in a `.cook` source that are NOT
   * well-formed. norish's own serializer emits ZERO; see the docblock above for
   * the measurement that makes this cap, not the byte cap, the real DoS control.
   */
  maxCookMalformedTokens: 8,
} as const;

export type CookLimitBreach = {
  limit: keyof typeof COOK_LIMITS;
  measured: number;
  allowed: number;
};

function breach(limit: keyof typeof COOK_LIMITS, measured: number): CookLimitBreach {
  return { limit, measured, allowed: COOK_LIMITS[limit] };
}

function overLimit(
  limit: keyof typeof COOK_LIMITS,
  measured: number
): CookLimitBreach | null {
  return measured > COOK_LIMITS[limit] ? breach(limit, measured) : null;
}

/**
 * Pre-serialization gate: is this structured recipe small enough to serialize and
 * hand to the parser?
 *
 * Returns the FIRST breach found (cheapest checks first, so a hostile input is
 * refused without walking every step), or `null` when the recipe is within every
 * cap. Total by contract — it never throws, whatever shape it is handed.
 */
export function checkStructuredRecipeLimits(recipe: StructuredRecipe): CookLimitBreach | null {
  if (!recipe || typeof recipe !== "object") return null;

  const nameBreach = overLimit("maxRecipeNameChars", (recipe.name ?? "").length);

  if (nameBreach) return nameBreach;

  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const stepsBreach = overLimit("maxSteps", steps.length);

  if (stepsBreach) return stepsBreach;

  const totalRefs = steps.reduce(
    (total, step) => total + (Array.isArray(step?.ingredients) ? step.ingredients.length : 0),
    0
  );
  const totalRefsBreach = overLimit("maxTotalIngredientRefs", totalRefs);

  if (totalRefsBreach) return totalRefsBreach;

  for (const step of steps) {
    const textBreach = overLimit("maxStepTextChars", (step?.text ?? "").length);

    if (textBreach) return textBreach;

    const ingredients = Array.isArray(step?.ingredients) ? step.ingredients : [];
    const refsBreach = overLimit("maxIngredientRefsPerStep", ingredients.length);

    if (refsBreach) return refsBreach;

    const timers = Array.isArray(step?.timers) ? step.timers : [];
    const timersBreach = overLimit("maxTimersPerStep", timers.length);

    if (timersBreach) return timersBreach;

    for (const ingredient of ingredients) {
      const refNameBreach = overLimit("maxRefNameChars", (ingredient?.name ?? "").length);

      if (refNameBreach) return refNameBreach;

      const unitBreach = overLimit("maxUnitChars", (ingredient?.unit ?? "").length);

      if (unitBreach) return unitBreach;
    }

    for (const timer of timers) {
      const timerNameBreach = overLimit("maxRefNameChars", (timer?.name ?? "").length);

      if (timerNameBreach) return timerNameBreach;

      const timerUnitBreach = overLimit("maxUnitChars", (timer?.unit ?? "").length);

      if (timerUnitBreach) return timerUnitBreach;
    }
  }

  return null;
}

/** A Cooklang token name may start with any letter or digit. */
const NAME_START = /[\p{L}\p{N}]/u;

/** Is there a `}` at or after `from` before the next newline? */
function closesOnSameLine(source: string, from: number): boolean {
  const close = source.indexOf("}", from);

  if (close < 0) return false;

  const newline = source.indexOf("\n", from);

  return newline < 0 || newline > close;
}

/**
 * Count the Cooklang token starts in `source` that are NOT well-formed.
 *
 * A token start is `@` (ingredient), `#` (cookware) or `~` (timer). It is
 * well-formed when it is followed either by a name character or by a `{` whose
 * matching `}` appears on the SAME line. Everything else — a bare sigil, two
 * adjacent sigils, an unterminated `{` — is a token the parser emits a diagnostic
 * for, and diagnostics are what make the parser slow (module docblock).
 *
 * Single pass, no backtracking: this runs BEFORE the parser on every source, so it
 * must stay cheap. The scans are bounded by the already-enforced byte cap.
 */
export function countMalformedCookTokens(source: string): number {
  let malformed = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char !== "@" && char !== "#" && char !== "~") continue;

    const next = source[index + 1] ?? "";

    if (next === "{") {
      if (!closesOnSameLine(source, index + 2)) malformed += 1;
      continue;
    }

    if (!NAME_START.test(next)) {
      malformed += 1;
      continue;
    }

    // A named token: `@flour` is complete, `@flour{200%gram}` must close its brace.
    let cursor = index + 1;

    while (cursor < source.length && !/[\s{]/.test(source[cursor] ?? "")) cursor += 1;

    if (source[cursor] === "{" && !closesOnSameLine(source, cursor + 1)) malformed += 1;
  }

  return malformed;
}

/**
 * Pre-parse gate: is this `.cook` source safe to hand to the WASM parser?
 *
 * `maxCookSourceBytes` is measured with `Buffer.byteLength(src, "utf8")` — the cap
 * is BYTES, not code units, because the parser allocates over the encoded bytes and
 * a string of astral-plane characters carries up to 4x its `.length` in bytes.
 *
 * `maxCookMalformedTokens` is what actually bounds parse TIME; the byte cap alone
 * does not (module docblock). It is checked second because it is the more expensive
 * of the two, and the byte cap bounds the work it has to do.
 *
 * A non-string is not a breach; `parseCookSource`'s own type guard rejects it.
 */
export function checkCookSourceLimits(cookSource: string): CookLimitBreach | null {
  if (typeof cookSource !== "string") return null;

  const bytesBreach = overLimit("maxCookSourceBytes", Buffer.byteLength(cookSource, "utf8"));

  if (bytesBreach) return bytesBreach;

  return overLimit("maxCookMalformedTokens", countMalformedCookTokens(cookSource));
}
