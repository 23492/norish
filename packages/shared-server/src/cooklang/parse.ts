import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";

import { parserLogger as log } from "../logger";

import { checkCookSourceLimits, findCookSourceDefect } from "./limits";
import { parseInPool } from "./pool";

/**
 * The pool's lifecycle helper, re-exported HERE and not from `./pool` itself.
 *
 * `./cooklang/pool` is no longer an exported subpath of `@norish/shared-server`
 * (D-27-W3B-15 — VERIFY-3 blocker 4): a module that reaches the WASM must not be
 * importable from another package, or the "single caller" discipline this design
 * leans on is a convention rather than a boundary. But other packages' suites do
 * legitimately need to tear the pool down — vitest will not exit while a child
 * process lives — and that is a LIFECYCLE concern, not a parsing one.
 *
 * So the door re-exports it and the pool stays sealed: a suite gets
 * `shutdownCookParsePool` without `parseInPool` coming along with it.
 */
export { shutdownCookParsePool } from "./pool";

/**
 * Server-only `.cook` -> `cookTokens` read model (Phase 27, W1; bounded in W3B).
 *
 * Lives in `@norish/shared-server` and NOT in `@norish/shared` (D-27-W1-01):
 * `@norish/shared` is bundled by `apps/mobile`, and a WASM binary must never
 * reach the Expo bundle. Clients render the plain-JSON projection this module
 * produces; only the server ever runs the parser.
 *
 * THE PARSER IS NOT IN THIS PROCESS ANY MORE (W3B). It runs in a pooled child
 * process (`./pool` -> `./parse-worker`), which is also where the index
 * dereferencing and token projection happen — a `CooklangRecipe` is a class
 * instance and cannot cross the boundary, so only plain JSON does. That is why
 * this module no longer imports `@cooklang/cooklang`, and why `parseCookSource`
 * is `async`.
 */

/**
 * Parse a `.cook` source into the `cookTokens` read model.
 *
 * FAILURE MODE IS PART OF THE CONTRACT: this resolves `null` and NEVER rejects
 * into its caller — W2 puts it on a request path. `null` means "no trustworthy
 * read model", and the caller falls back to the legacy render path.
 *
 * ============================================================================
 * WHAT ACTUALLY GUARANTEES THIS IS SAFE: A RESOURCE BOUND, NOT A RECOGNIZER.
 * ============================================================================
 *
 * THE PREVIOUS VERSION OF THIS DOCBLOCK CLAIMED SOMETHING FALSE, and the claim is
 * worth recording so it is not made a fourth time. It said a bad `cook_source`
 * "can never reach the WASM parser", because `buildCookPayload` validates
 * everything on the way in. That was refuted twice over:
 *
 *  1. `findCookSourceDefect` was itself incomplete. Its frontmatter recognizer
 *     accepted arbitrary YAML, so `---\na: ${"[".repeat(65400)}\n---\nstep\n`
 *     passed both gates and parsed for **24 557 / 38 511 ms**. The round before
 *     that had been refuted in the other direction too — it REFUSED an ordinary
 *     536-byte pot roast the real parser handled in 13 ms. Three rounds of
 *     "complete the recognizer" each discovered a sub-grammar the last did not
 *     know about.
 *  2. "Validated at write" is not airtight for stored rows, whatever the
 *     recognizer says. `copyRecipeForSave` carried a `cook_source` across without
 *     re-validating it, W5's backfill will write `cook_source` in bulk, and a row
 *     can be edited by an operator or restored from a dump. The READ path is a
 *     request-path door on DB CONTENT.
 *
 * SO THE GUARANTEE IS NOW THIS, AND IT DOES NOT DEPEND ON RECOGNIZING ANYTHING:
 *
 *     ANYTHING THAT REACHES THE PARSER IS BOUNDED, WHATEVER WROTE IT.
 *
 * Every parse runs in a pooled child process under a **1 500 ms CHILD-CPU gate**
 * and a **512 MB CHILD-RSS gate** (both `SIGKILL` from the parent, sampled from
 * `/proc/<pid>/schedstat` and `/proc/<pid>/status` on one 25 ms poll), an 8 000 ms
 * wall-clock BACKSTOP for a child that is stuck without burning CPU, and a 256 MB
 * V8 old-space flag. A bound hit kills and replaces the child and resolves `null`.
 *
 * The primary gate is CPU rather than wall clock because wall clock conflates the
 * threat with unrelated host load, and was measured refusing legitimate recipes
 * under contention (D-27-W3B-03a, superseding the 1 000 ms wall-clock bound this
 * comment used to describe). The MEMORY bound is the child's resident set rather
 * than `--max-old-space-size` because that flag caps V8's old generation only and
 * the parser allocates in WASM linear memory — the same child measured 899 MB of
 * RSS with the flag set (D-27-W3B-14, superseding the "256 MB heap bound" this
 * comment also used to describe). See `./limits` for the four bounds and `./pool`
 * for the measurements behind them and for why the mechanism is a child process
 * rather than a worker thread.
 *
 * THE BYTE CAP AND `findCookSourceDefect` STAY, AND THEY ARE STILL CHECKED FIRST
 * — as DEFENCE IN DEPTH, not as the guarantee. They keep a known-bad source from
 * costing a process round trip at all, they keep the diagnostics-based confidence
 * signal W5 wants, and they are why a legitimate recipe never comes near a bound.
 * The difference that matters: **a future gap in the recognizer now costs one
 * refused or slow-but-bounded parse, not an unbounded one.** It is a quality
 * issue, not a security incident. That is the entire point of the W3B pivot.
 *
 * `null` is resolved when:
 *  - the source breaches `COOK_LIMITS.maxCookSourceBytes` (T-27-01) — this is the
 *    FIRST statement, so an oversize source never even reaches the pool;
 *  - the source is not something norish's own serializer could have written
 *    (`findCookSourceDefect`, T-27-01);
 *  - the input is not a non-blank string;
 *  - the parse hit either bound, the child crashed or trapped, no child could be
 *    spawned, or the pool was saturated (all logged by `./pool`);
 *  - the parser threw;
 *  - the source yields no steps;
 *  - the parser emitted ANY diagnostic. norish AUTHORS every `.cook` it stores
 *    (D-3), so a diagnostic means our own writer produced something the parser
 *    did not fully understand. Rendering a partially-understood recipe is worse
 *    than falling back, and the signal is exactly what W5's confidence gate wants.
 *
 * `scale` is forwarded verbatim to the WASM (D-27-W3B-11). norish does not pass
 * one today, so behaviour is unchanged; W4's servings scaling can use it without
 * re-plumbing the process boundary.
 */
export async function parseCookSource(
  cookSource: string,
  units?: UnitsMap,
  scale?: number
): Promise<CookTokensDTO | null> {
  const breach = checkCookSourceLimits(cookSource);

  if (breach) {
    // REJECT, never truncate: a truncated `.cook` parses cleanly and would store a
    // source that silently omits steps. Counts only — never the source (T-27-05).
    log.warn(
      {
        module: "cooklang",
        reason: "input-too-large",
        limit: breach.limit,
        measured: breach.measured,
        allowed: breach.allowed,
      },
      "Cooklang source exceeds the input-size cap; refusing to parse"
    );

    return null;
  }

  const defect = findCookSourceDefect(cookSource);

  if (defect) {
    // Counts, codes and an OFFSET only — never the source (T-27-05).
    log.warn(
      {
        module: "cooklang",
        reason: "not-serializer-shaped",
        defect: defect.defect,
        offset: defect.offset,
        bytes: typeof cookSource === "string" ? Buffer.byteLength(cookSource, "utf8") : 0,
      },
      "Cooklang source is not well-formed serializer output; refusing to parse"
    );

    return null;
  }

  if (typeof cookSource !== "string" || cookSource.trim() === "") return null;

  // The bounded parse. `parseInPool` never throws and never hangs; it resolves
  // `null` for every failure mode and logs the reason with counts and a pid.
  return parseInPool(cookSource, units, scale);
}
