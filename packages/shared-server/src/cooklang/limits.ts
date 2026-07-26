import type { StructuredRecipe } from "@norish/shared/cooklang";

/**
 * Input-size limiting for the Cooklang pipeline (Phase 27, T-27-01 / W3).
 *
 * WHY THIS MODULE EXISTS. `@cooklang/cooklang` is a compiled Rust/WASM binary.
 * From W3 onward it is reached by text that a scraped page, an uploaded photo or
 * a video transcript steered a language model into producing — native code on the
 * far side of a prompt-injection surface. These caps bound *what and how much is
 * allowed in*, and they are enforced INSIDE the two and only two doors to the
 * parser (`buildCookPayload` and `parseCookSource`), never at their call sites.
 *
 * THIS MODULE IS DEFENCE IN DEPTH. IT IS NOT THE GUARANTEE (W3B, D-27-W3B-13).
 * An earlier version of this docblock said the recognizer below "turns the time
 * bound into a CHECKED precondition". That claim is void — see the section at the
 * end of this comment — and it is void in a way that matters, because acting on it
 * is what produced two refuted mitigations. The hard guarantee is a RESOURCE BOUND
 * on the parse itself (`./pool`: a 1 000 ms `SIGKILL` wall-clock bound and a
 * 256 MB heap bound, in a pooled child process). The caps and the recognizer here
 * run FIRST and still earn their place — they stop a known-bad source from costing
 * a process round trip, they feed W5's confidence signal, and they are why a real
 * recipe never comes near a bound — but a gap in them now costs one refused or
 * slow-but-bounded parse, NOT an unbounded one.
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
 * WHY A BYTE CAP ALONE IS NOT ENOUGH — and why the second gate is a RECOGNIZER,
 * not a heuristic count (T-27-01 root-cause fix).
 * A size cap bounds how much text the parser reads; it does NOT bound how long the
 * parser takes. `@cooklang/cooklang@0.18.7` renders a DIAGNOSTIC per malformed token
 * and each diagnostic quotes the whole LINE it sits on, so report construction costs
 * O(malformed tokens x line length) and the returned report string crosses the WASM
 * boundary. Measured on this tree, all WITHIN a 64 KiB source:
 *
 *   | source (64 KiB unless stated)            | parse time | report  |
 *   |------------------------------------------|-----------:|--------:|
 *   | 16 lines x 3 996 chars of `@a{1%} `      |  11 118 ms |  ~150MB |
 *   | `("#" x 8 + " ")` x 128 + one long word  |  18 387 ms |  ~250MB |
 *   | `"#" x 4096` (4 KiB source!)             |   4 553 ms |   ~17MB |
 *   | `"@" x 65536`                            |   4 281 ms |       - |
 *   | `~10 minutes` anywhere in a 16 KiB line  |  WASM trap |       - |
 *
 * Lowering `maxCookSourceBytes` cannot fix this: the worst case is NON-MONOTONIC in
 * the cap (a 4 KiB `#` run already costs 4.5 s), so there is no byte cap that is both
 * safe and large enough for a real recipe — the five committed fixtures already
 * serialize to 225-506 bytes and a plain 9-step recipe to 536.
 *
 * THE FIRST ATTEMPT AT THIS GATE WAS A HEURISTIC AND IT FAILED IN BOTH DIRECTIONS.
 * `maxCookMalformedTokens: 8` + `countMalformedCookTokens` tried to PREDICT which
 * tokens the WASM parser would object to, i.e. to reimplement the parser's grammar
 * with a regex. That is necessarily incomplete AND over-broad, and an adversarial
 * verifier demonstrated both: `@a{1%}` closes its brace, so the counter scored the
 * 64 KiB source above as ZERO malformed and let it through (11 s, 150 MB); while an
 * ordinary 536-byte recipe using US shorthand ("Preheat the oven @ 325", "a 3 #
 * chuck roast", "reduce ~ 10 minutes") scored 12 and was REFUSED, although the real
 * parser handles it in 13 ms with an empty report. Predicting a parser is a bandaid.
 *
 * WHAT REPLACED IT. norish AUTHORS every `.cook` it stores (D-3), and its serializer
 * now ESCAPES every Cooklang metacharacter in prose, heading text, token names,
 * amounts and units (`@norish/shared/cooklang`'s `escapeCookText`). So the invariant
 * "our `.cook` contains exactly the tokens we intended, and nothing else the parser
 * can lex" is true BY CONSTRUCTION. `findCookSourceDefect` does not predict the
 * parser; it ASSERTS that invariant — a strict left-to-right recognizer for the
 * serializer's own output grammar. Sound in both directions:
 *   - no bypass: `@a{1%}` (empty unit), `~{5}` / `~a{5}` (no unit), a bare sigil, a
 *     sigil flood, an unbalanced brace and a bare `~10 minutes` are all rejected,
 *     because none of them is a shape the serializer can emit;
 *   - no legitimate refusal: prose reaches this gate already escaped, so
 *     "Preheat the oven @ 325" arrives as `\@ 325` and passes.
 *
 * AND THAT WAS ALSO REFUTED — WHICH IS WHY THE BOUND EXISTS (W3B).
 * The recognizer was sound about the BODY grammar and unsound about FRONTMATTER:
 * `FRONTMATTER_LINE` constrained neither the key nor the value, so ARBITRARY YAML
 * passed both gates. `---\na: ${"[".repeat(65400)}\n---\nstep\n` — 65 417 bytes,
 * inside every cap, no defect reported — parsed for **24 557 ms / 38 511 ms** with
 * a 131 218-byte "recursion limit exceeded" report. Balanced 25 000- and
 * 30 000-deep variants cost 4 838 ms and 8 256 ms: a monotone FAMILY, not a lucky
 * point.
 *
 * So the lesson, recorded here because this is the third place the same mistake
 * could be made: **A RECOGNIZER FOR A GRAMMAR YOU DO NOT OWN CANNOT BE THE
 * GUARANTEE.** Each of the three rounds was complete with respect to the
 * sub-grammar its author knew about. What bounds parse time is `./pool`'s
 * wall-clock `SIGKILL`, which needs to understand nothing about the input at all.
 * A source that passes both gates here is at most 64 KiB of what we believe to be
 * diagnostic-free, well-formed Cooklang — a good bet, and no longer a load-bearing
 * one.
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
} as const;

/**
 * Read a positive-integer operational override, or fall back to the calibrated
 * default. A malformed or non-positive value is IGNORED rather than honoured:
 * `NORISH_COOK_PARSE_CPU_MS=0` must not silently disable the bound.
 */
function boundFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number.parseInt(raw, 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * THE RESOURCE BOUND ON THE PARSE (Phase 27, W3B — D-27-W3B-03a, superseding
 * D-27-W3B-03).
 *
 * A SEPARATE object from `COOK_LIMITS` on purpose: those nine are INPUT-SHAPE
 * caps and they are unchanged by the W3B pivot. These are the RESOURCE bound,
 * which is what the guarantee now rests on. All of it is enforced by `./pool`.
 *
 * ─── WHY THE PRIMARY GATE IS CPU TIME AND NOT WALL CLOCK ───────────────────
 *
 * D-27-W3B-03 bounded ONE PARSE BY WALL CLOCK at 1 000 ms, chosen deliberately
 * above the worst legitimate shapes (648 / 694 ms measured idle) so that nothing
 * which parses today would start failing. It was then MEASURED TO FLIP: in the
 * full `@norish/shared-server` run (~20 vitest workers) those same legitimate
 * shapes took **1 238 ms and 1 137 ms of WALL CLOCK and were REFUSED**, while the
 * work they performed had not changed at all. On LXC 110 the web server, the queue
 * workers and Postgres share four cores, so that is reachable in production.
 *
 * The root cause is that WALL CLOCK CONFLATES THE THREAT WITH UNRELATED HOST LOAD.
 * A pathological parse burns CPU. A legitimate parse under contention burns the
 * same small amount of CPU and only inflates in ELAPSED time. Any number on the
 * wall-clock axis is therefore wrong on some box: 1 000 ms refuses real recipes
 * here, and 2 000 ms would refuse them on a busier host. Measured on this box, by
 * pinning the child and ten spinners to one core:
 *
 * | worst ACCEPTED shape        | wall idle | wall starved  | CPU idle | CPU starved |
 * |-----------------------------|----------:|--------------:|---------:|------------:|
 * | 64 KiB of `@a{1%g} `        | 351-449   | 4 096-5 085   | 328-373  | 328-373     |
 * | `"#p " x 21845`             | 483-830   | 5 537-6 264   | 453-506  | 452-506     |
 *
 * Wall clock inflated **7.5x-11.6x**. The CPU figure did not move: it is flat
 * within ±3% across an order of magnitude of host load. That is the axis the bound
 * belongs on, and it is why this is a root-cause fix rather than a retune.
 *
 * This matters MORE from W6 on, not less: W6 makes `cook_source` NOT NULL, so a
 * refusal that costs only a legacy render today becomes an IMPORT FAILURE then. A
 * contention-flaky bound is a latent W6 defect.
 *
 * ─── THE THREE BOUNDS, AND WHY NONE IS REDUNDANT ───────────────────────────
 *
 *  1. `cookParseCpuMs` (1 500 ms) — THE PRIMARY GATE. The child cannot police
 *     itself: the WASM parse is a single synchronous call that can never check a
 *     timer, which is the whole reason this pivot exists. So the PARENT samples the
 *     child's own CPU counter from `/proc/<pid>/schedstat` every
 *     `cookParseCpuPollMs` and `SIGKILL`s it when the budget is spent. Measured
 *     hostile cost, on the artefacts that refuted rounds 1 and 2: H1's 65 KB
 *     `[`-repeat frontmatter burns **22 759 ms** of CPU, `"#" x 8192` **12 222 ms**,
 *     the round-1 bypass **4 895 ms**. All three are killed after 1 500 ms.
 *  2. `cookParseWallCeilingMs` (8 000 ms) — A BACKSTOP, NOT A COMPUTATION BOUND.
 *     Its only job is a child that is stuck WITHOUT burning CPU: a hang, a lost IPC
 *     reply, a child descheduled forever. The CPU gate can never see that case
 *     because the counter does not advance. It is deliberately GENEROUS because a
 *     blocked-but-idle child is not a DoS amplifier — it occupies one pool slot,
 *     `cookParseQueueTimeoutMs` stops anything queueing behind it, and
 *     D-27-W3B-10's terminate-and-replace disposes of it. 8 000 ms is 9.6x the
 *     worst legitimate shape's IDLE wall clock (830 ms) and still above the
 *     6 264 ms measured under the 11.6x single-core starvation above — i.e. above a
 *     condition harsher than four-core LXC 110 can present.
 *  3. `cookParseHeapMb` (256 MB) — unchanged, and MORE load-bearing than before.
 *     `"#" x 8192` (an **8 KiB** input) peaks at **839 MB** and the round-1 bypass
 *     at **1 650 MB**. The heap bound was measured to fire at 6-12 s rather than the
 *     predicted ~285 ms, so it is not the gate that fires first — but it is the only
 *     thing standing between a hostile row and a 1.65 GB balloon now that the
 *     wall-clock ceiling has risen to 8 s. Do not treat it as redundant.
 *
 * WHY 1 500 ms OF CPU. Measured against the worst LEGITIMATE shapes, not guessed.
 * A sweep of every shape that reaches the 64 KiB `cook_source` cap — the two above
 * plus timers, prose, headings, 200x4 000-char steps, 600 ingredient refs and real
 * frontmatter — puts the worst legitimate CPU cost at **506 ms**. 1 500 ms is
 * **2.96x** over that, ~88x over a realistic 448-byte recipe (17 ms) and ~2 500x
 * over a committed fixture. It is also LOWER in absolute terms than the wall-clock
 * worst case a hostile row could previously hold a child for, so the bound got
 * tighter against the threat while getting 3x safer for real recipes.
 *
 * WHY THE POLL IS 25 ms. Resolution: a hostile parse overshoots the budget by at
 * most one interval, 1.7% of 1 500 ms. Cost: the poll is a `setTimeout` that is
 * cleared before it ever fires for any normal parse — a pooled round trip is
 * ~0.97 ms and a 64 KiB realistic recipe ~15 ms, both measured to fire ZERO polls.
 * When it does fire, one sample costs **30 µs** (measured, 20 000 iterations), so
 * the worst legitimate shape pays ~20 samples ≈ 0.6 ms and a hostile parse ~60
 * samples ≈ 1.8 ms.
 *
 * WHY POOL SIZE 2. Not throughput (one child serves ~1 000 parses/s) —
 * HEAD-OF-LINE BLOCKING. With one child, a single bounded-out parse would delay
 * every queued read. Worst-case transient memory is
 * `cookParsePoolSize x cookParseHeapMb`.
 *
 * Each value is env-overridable for operational headroom. Raising one is a
 * deliberate act with a recorded reason, never a guess.
 */
export const COOK_BOUNDS = {
  /**
   * THE PRIMARY GATE: ms of the child's own CPU time for ONE parse, sampled by the
   * parent from `/proc/<pid>/schedstat` and enforced by `SIGKILL`.
   */
  cookParseCpuMs: boundFromEnv("NORISH_COOK_PARSE_CPU_MS", 1_500),
  /** How often the parent samples the child's CPU counter while a parse is in flight. */
  cookParseCpuPollMs: boundFromEnv("NORISH_COOK_PARSE_CPU_POLL_MS", 25),
  /**
   * The WALL-CLOCK BACKSTOP for one parse. Catches a child that is stuck without
   * burning CPU, which the CPU gate cannot see. NOT the computation bound.
   */
  cookParseWallCeilingMs: boundFromEnv("NORISH_COOK_PARSE_WALL_CEILING_MS", 8_000),
  /** The child's `--max-old-space-size`, in MB. */
  cookParseHeapMb: boundFromEnv("NORISH_COOK_PARSE_HEAP_MB", 256),
  /** Children in the pool. Lazily spawned; a process that never parses spawns none. */
  cookParsePoolSize: boundFromEnv("NORISH_COOK_PARSE_POOL_SIZE", 2),
  /** Wall-clock ms a request may wait for a free child before degrading to `null`. */
  cookParseQueueTimeoutMs: boundFromEnv("NORISH_COOK_PARSE_QUEUE_TIMEOUT_MS", 1_000),
  /**
   * Wall-clock ms a request may wait for a COLD child's warm-up handshake. Kept at
   * the 2 000 ms this used to be derived as (`queueTimeout + parseTimeout`) so the
   * cold-spawn path is unchanged by D-27-W3B-03a: ~8x the measured 200-243 ms cold
   * spawn, and a BOUND — if it expires the request degrades to `null`, never hangs.
   */
  cookParseReadyTimeoutMs: boundFromEnv("NORISH_COOK_PARSE_READY_TIMEOUT_MS", 2_000),
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

/**
 * Pre-parse gate 1 of 2: is this `.cook` source small enough to hand to the WASM
 * parser?
 *
 * `maxCookSourceBytes` is measured with `Buffer.byteLength(src, "utf8")` — the cap
 * is BYTES, not code units, because the parser allocates over the encoded bytes and
 * a string of astral-plane characters carries up to 4x its `.length` in bytes.
 *
 * A non-string is not a breach; `parseCookSource`'s own type guard rejects it.
 */
export function checkCookSourceLimits(cookSource: string): CookLimitBreach | null {
  if (typeof cookSource !== "string") return null;

  return overLimit("maxCookSourceBytes", Buffer.byteLength(cookSource, "utf8"));
}

/** Why a `.cook` source is not something norish's own serializer could have written. */
export type CookSourceDefectCode =
  | "frontmatter-unterminated"
  | "frontmatter-line"
  | "malformed-heading"
  | "malformed-token"
  | "unescaped-metacharacter"
  | "invalid-escape";

export type CookSourceDefect = {
  defect: CookSourceDefectCode;
  /** Character offset of the defect. A POSITION, never a quotation (T-27-05). */
  offset: number;
};

/**
 * Every character the Cooklang dialect norish writes attaches meaning to. Mirrors
 * `COOK_METACHARACTERS` in `@norish/shared/cooklang`'s serializer — the escaper and
 * this recognizer are two halves of one contract, and
 * `cook-metacharacters.test.ts` proves the set is EXHAUSTIVE by round-tripping
 * every ASCII punctuation character through the real parser.
 */
const COOK_METACHARACTERS = "\\@#~{}%=>-";

/**
 * A section heading exactly as `serializeWithReport` writes it: `== ` + escaped
 * heading text + ` ==`, where the text carries no RAW metacharacter.
 */
const HEADING_LINE = /^== (?:\\[^\n]|[^\\@#~{}%=>\-\n])* ==$/;

/** A frontmatter line exactly as `buildFrontmatter` writes it: `key: value`. */
const FRONTMATTER_LINE = /^[A-Za-z][A-Za-z0-9._-]*: .*$/;

/**
 * A character that may appear RAW in a BARE `@name` token. Mirrors the serializer's
 * `SINGLE_WORD_STOP` (which is what decides that a name needs no braces) plus the
 * metacharacters, none of which can survive escaping unbraced.
 */
const BARE_NAME_CHAR = /[^\s\\@#~{}%=>\-\[\](),;:!?.]/;

/**
 * Is `at` the start of an escape pair the serializer could have written? Only a
 * METACHARACTER is ever escaped (`escapeCookText`), so `\ ` or `\a` is not
 * serializer output — and requiring that keeps the recognizer's "every raw
 * metacharacter is a defect" rule exhaustive rather than side-steppable.
 */
function isEscapePair(line: string, at: number): boolean {
  const escaped = line[at + 1];

  return escaped !== undefined && COOK_METACHARACTERS.includes(escaped);
}

/**
 * Match a `{amount%unit}` body starting at the `{` in `line`.
 *
 * Returns the index just past the closing `}`, or -1. Rejects exactly the shapes
 * that make the parser emit a diagnostic, which is what makes it slow:
 * `{1%}` (`Empty quantity unit`), `{%g}` (no amount) and, for a timer, a body with
 * no `%unit` at all (`Invalid timer quantity`). `{}` IS legal — it is how the
 * serializer writes a multi-word amount-less ingredient (`@sea salt{}`).
 */
function matchTokenBody(line: string, from: number, requireUnit: boolean): number {
  let index = from + 1;
  let sawPercent = false;
  let amountChars = 0;
  let unitChars = 0;

  for (;;) {
    const char = line[index];

    if (char === undefined) return -1;

    if (char === "\\") {
      if (!isEscapePair(line, index)) return -1;

      if (sawPercent) unitChars += 1;
      else amountChars += 1;
      index += 2;
      continue;
    }

    if (char === "}") {
      if (sawPercent && (amountChars === 0 || unitChars === 0)) return -1;
      if (requireUnit && (!sawPercent || amountChars === 0)) return -1;

      return index + 1;
    }

    if (char === "%") {
      if (sawPercent) return -1;
      sawPercent = true;
      index += 1;
      continue;
    }

    if (COOK_METACHARACTERS.includes(char)) return -1;

    if (sawPercent) unitChars += 1;
    else amountChars += 1;
    index += 1;
  }
}

/**
 * Match one well-formed Cooklang token starting at the sigil in `line`.
 *
 * Returns the index just past the token, or -1. The two forms are unambiguous
 * because a name can never contain a RAW `{`: scan forward over escape pairs and
 * ordinary characters, and if the scan reaches a raw `{` this is the BRACED form,
 * otherwise it is the BARE `@name` / `#name` form (a timer has no bare form — it
 * always carries a quantity).
 *
 * `#` cookware is accepted although norish's serializer never emits it: it is a
 * well-formed, diagnostic-free, fast token, `toCookTokens` has a branch that keeps
 * its name readable in the prose, and prose can no longer produce one by accident
 * now that `#` is escaped. Accepting it costs nothing the time bound depends on.
 */
function matchToken(line: string, at: number): number {
  const sigil = line[at];
  let index = at + 1;

  for (;;) {
    const char = line[index];

    if (char === undefined) break;

    if (char === "\\") {
      if (!isEscapePair(line, index)) break;
      index += 2;
      continue;
    }

    if (char === "{") {
      // `@{...}` / `#{...}` has no name, and the parser cannot name a component from it
      if (sigil !== "~" && index === at + 1) return -1;

      return matchTokenBody(line, index, sigil === "~");
    }

    if (COOK_METACHARACTERS.includes(char)) break;

    index += 1;
  }

  if (sigil === "~") return -1;

  let bare = at + 1;

  while (bare < line.length && BARE_NAME_CHAR.test(line[bare] ?? "")) bare += 1;

  return bare > at + 1 ? bare : -1;
}

/** Recognize one body line: a heading, or an alternation of escaped prose and tokens. */
function findLineDefect(line: string, base: number): CookSourceDefect | null {
  if (line === "") return null;

  if (line.startsWith("== ")) {
    return HEADING_LINE.test(line) ? null : { defect: "malformed-heading", offset: base };
  }

  let index = 0;

  while (index < line.length) {
    const char = line[index] ?? "";

    if (char === "\\") {
      if (!isEscapePair(line, index)) return { defect: "invalid-escape", offset: base + index };
      index += 2;
      continue;
    }

    if (char === "@" || char === "#" || char === "~") {
      const next = matchToken(line, index);

      if (next < 0) return { defect: "malformed-token", offset: base + index };

      index = next;
      continue;
    }

    if (COOK_METACHARACTERS.includes(char)) {
      return { defect: "unescaped-metacharacter", offset: base + index };
    }

    index += 1;
  }

  return null;
}

/**
 * Pre-parse gate 2 of 2: is this `.cook` source something norish's own serializer
 * could have written?
 *
 * This is an OUTPUT-INTEGRITY ASSERTION, not an input heuristic. norish authors
 * every `.cook` it stores (D-3) and its serializer escapes every metacharacter in
 * untrusted text, so a source that fails here did not come from the serializer —
 * either the serializer regressed or something else wrote the row. Both mean "do
 * not hand this to native code"; see the module docblock for why the previous
 * predict-the-parser approach was unsound in both directions.
 *
 * Single left-to-right pass, no backtracking, bounded by the already-enforced byte
 * cap, so it cannot itself become the slow path. Returns `null` when the source is
 * well-formed. A non-string is not a defect; `parseCookSource`'s type guard owns it.
 */
export function findCookSourceDefect(cookSource: string): CookSourceDefect | null {
  if (typeof cookSource !== "string") return null;

  let cursor = 0;

  if (cookSource.startsWith("---\n")) {
    const end = cookSource.indexOf("\n---\n", 3);

    if (end < 0) return { defect: "frontmatter-unterminated", offset: 0 };

    let lineStart = 4;

    for (const line of cookSource.slice(4, end + 1).split("\n")) {
      if (line !== "" && !FRONTMATTER_LINE.test(line)) {
        return { defect: "frontmatter-line", offset: lineStart };
      }

      lineStart += line.length + 1;
    }

    cursor = end + 5;
  }

  while (cursor < cookSource.length) {
    const newline = cookSource.indexOf("\n", cursor);
    const end = newline < 0 ? cookSource.length : newline;
    const defect = findLineDefect(cookSource.slice(cursor, end), cursor);

    if (defect) return defect;

    cursor = end + 1;
  }

  return null;
}
