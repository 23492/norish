// @vitest-environment node
/**
 * THE RESOURCE BOUND ON THE WASM PARSE (Phase 27, W3B — T-27-01).
 *
 * WHAT THIS FILE IS FOR. T-27-01 was mitigated twice by trying to RECOGNIZE
 * hostile input, and refuted twice — a predictive token counter, then a
 * serializer-output recognizer. The lesson is that input-shape validation cannot
 * be the guarantee for this parser, because its failure modes are unbounded:
 * quadratic diagnostics (839 MB out of an 8 KiB input), YAML recursion (24-38 s of
 * pure CPU at a flat 6 MB) and `RuntimeError: unreachable` on nine bytes. So the
 * PARSE is bounded, and this file is the proof.
 *
 * THE PRIMARY GATE IS THE CHILD'S CPU TIME, NOT WALL CLOCK (D-27-W3B-03a). That
 * changes what a bound test may honestly assert, and it is worth stating up front
 * because getting it wrong is what made the previous version of this file red in the
 * full run and green in isolation:
 *
 *  - A "the bound fired within N ms of WALL CLOCK" assertion is a measurement OF THE
 *    MACHINE. Under contention a hostile row takes longer in elapsed time to burn its
 *    CPU budget, so any tight wall-clock ceiling on a hostile input is flaky by
 *    construction. Those assertions now bound only `cookParseWallCeilingMs` — i.e.
 *    they assert "it did not hang", which is all wall clock can honestly say.
 *  - The assertions WITH TEETH are on the number the gate actually decides with: the
 *    CPU cost it sampled, which was measured flat within ±3% across an 11.6x
 *    wall-clock inflation. Those are contention-invariant.
 *  - `stub-parse-worker.mjs` makes the CPU-versus-wall-clock distinction
 *    DETERMINISTIC in both directions, with no reliance on host load at all.
 *
 * No timing assertion here leans on vitest's own timeout. A test that dies on the
 * harness timeout proves nothing about the bound: it proves the harness has one.
 *
 * THE ASSERTIONS WITH THE MOST TEETH are the ones fed inputs that were MEASURED
 * to cost 6-38 seconds or gigabytes of RSS in-process. They are also fed WITHOUT
 * any help from `findCookSourceDefect` — this module is the layer BELOW the
 * recognizer, so nothing here can pass because a recognizer refused the input.
 * That is deliberate and it is the whole point of the pivot.
 */

import type { UnitsMap } from "@norish/config/zod/server-config";
import { type ChildProcess, fork } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import defaultUnits from "@norish/config/units.default.json";
import { CookTokensSchema } from "@norish/shared/contracts/zod";
import type { StructuredRecipe } from "@norish/shared/cooklang";
import { structuredToCooklang } from "@norish/shared/cooklang";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";
import { COOK_BOUNDS, findCookSourceDefect } from "../../src/cooklang/limits";
import {
  cookParseChildCpuMsForTests,
  cookParseLastCpuMsForTests,
  cookParseLastRssMbForTests,
  cookParsePoolPidsForTests,
  parseInPool,
  parseInPoolBelowTheRecognizerForTests,
  shutdownCookParsePool,
} from "../../src/cooklang/pool";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_WORKER = join(HERE, "stub-parse-worker.mjs");

/** The bound D-27-W3B-03a replaced, quoted so the tests can show it would have refused. */
const SUPERSEDED_WALL_BOUND_MS = 1_000;

const units = defaultUnits as UnitsMap;

const errorSpy = vi.fn();
const warnSpy = vi.fn();

vi.mock("../../src/logger", () => ({
  parserLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: (...args: unknown[]) => errorSpy(...args),
  },
}));

/**
 * A realistic recipe at the size the serializer actually produces (the five
 * committed fixtures serialize to 225-506 B; this one mints to 486 B). This is the
 * shape whose latency matters, because it is the shape a real read path parses.
 *
 * IT IS MINTED BY THE REAL SERIALIZER, NEVER HAND-WRITTEN — and that is a fix, not
 * a style preference. This fixture WAS a hand-written `.cook` literal, and its
 * frontmatter was unquoted (`title: Weeknight Tomato Pasta`). Task 3's H1 root fix
 * (`5cdfc8aa`) made every non-numeric frontmatter value quoted UNCONDITIONALLY on
 * both sides of the contract, so from that commit on `findCookSourceDefect` refused
 * this literal with `{"defect":"frontmatter-value","offset":11}` in ~1 ms. It
 * survived here only because `parseInPool` sits BELOW the recognizer, so the ~15
 * assertions that lean on it — the read-path latency alarm, "a real recipe
 * round-trips through the process boundary", every `warmToExactlyOneChild()` — were
 * quietly exercising a source no norish serializer could have written.
 *
 * This is the same defect class as `cook-tokens-isolation.test.ts` (`1ec0a521`): a
 * hand-written `.cook` is an UNVERSIONED THIRD COPY of a contract the emitter and
 * the recognizer already share, and it rots the moment either half moves. Minting
 * it means this suite consumes whatever the emitter actually emits, and the guard
 * test below fails loudly instead of silently if the two ever diverge again.
 *
 * Blank-line separation, section headings and timer placement are therefore the
 * serializer's, not this file's: in Cooklang a step ends at a blank line, and
 * hand-writing that was already wrong here once (two steps instead of five).
 */
const REALISTIC_RECIPE: StructuredRecipe = {
  name: "Weeknight Tomato Pasta",
  servings: 4,
  systemUsed: "metric",
  steps: [
    { text: "# Prep", order: 0, ingredients: [] },
    {
      text: "Bring a large pot of salted water to a boil, then add the spaghetti.",
      order: 1,
      ingredients: [{ name: "spaghetti", amount: 400, unit: "gram" }],
    },
    {
      text: "Meanwhile warm the olive oil in a pan over medium heat.",
      order: 2,
      ingredients: [{ name: "olive oil", amount: 2, unit: "tablespoon" }],
    },
    {
      text: "Add the garlic and cook until fragrant.",
      order: 3,
      ingredients: [{ name: "garlic", amount: 3, unit: "clove" }],
      timers: [{ amount: 1, unit: "minutes" }],
    },
    { text: "# Finish", order: 4, ingredients: [] },
    {
      text: "Stir in the canned tomatoes and simmer.",
      order: 5,
      ingredients: [{ name: "canned tomatoes", amount: 800, unit: "gram" }],
      timers: [{ amount: 15, unit: "minutes" }],
    },
    {
      text: "Season with the salt and black pepper, then toss with the basil.",
      order: 6,
      ingredients: [
        { name: "salt", amount: 1, unit: "teaspoon" },
        { name: "black pepper", amount: 1, unit: "teaspoon" },
        { name: "basil", amount: 10, unit: "gram" },
      ],
    },
  ],
};

const REALISTIC = structuredToCooklang(REALISTIC_RECIPE, units);

/**
 * THE EXACT ARTEFACTS THAT REFUTED ROUND 2, plus round 1's bypass.
 *
 * Every `measured` figure is what the input cost the IN-PROCESS parse on this
 * tree. They are recorded here because they are the reason each assertion below
 * has teeth: without the bound, each of these inputs holds a request-serving
 * thread for seconds, or balloons a heap into the gigabytes.
 */
const HOSTILE: {
  name: string;
  source: string;
  measured: string;
  /**
   * `pure-cpu` means the shape allocates almost nothing (H1 was re-measured here at
   * a FLAT 79-85 MB of child RSS across a 1 505 ms parse), so no memory bound can
   * be what stops it and the reason is pinned exactly.
   * `balloons` shapes climb into the hundreds of MB, so `pool-rss` is the expected
   * outcome and the CPU gate / wall backstop remain correct outcomes under enough
   * contention — pinning one at the shipped defaults would be asserting a property
   * of the box (§15.3).
   */
  kills: "pure-cpu" | "balloons";
}[] = [
  {
    name: "H1 — 65 400 unbalanced `[` in frontmatter",
    source: `---\na: ${"[".repeat(65_400)}\n---\nstep\n`,
    measured: "24 557 ms / 38 511 ms in-process; 22 759 ms of CHILD CPU, flat 6 MB",
    kills: "pure-cpu",
  },
  {
    name: "H1 — balanced 25 000-deep `[`/`]` in frontmatter",
    source: `---\na: ${"[".repeat(25_000)}${"]".repeat(25_000)}\n---\nstep\n`,
    measured: "4 838 ms in-process",
    kills: "pure-cpu",
  },
  {
    name: "H1 — balanced 30 000-deep `[`/`]` in frontmatter",
    source: `---\na: ${"[".repeat(30_000)}${"]".repeat(30_000)}\n---\nstep\n`,
    measured: "8 256 ms in-process",
    kills: "pure-cpu",
  },
  {
    name: "H1 — `{`-nesting variant in frontmatter",
    source: `---\na: ${"{".repeat(30_000)}${"}".repeat(30_000)}\n---\nstep\n`,
    measured: "10 489 ms in-process",
    kills: "pure-cpu",
  },
  {
    name: "report explosion — `\"#\" x 8192` (8 KiB IN, 839 MB peak)",
    source: "#".repeat(8_192),
    measured: "839 MB peak RSS in-process from an 8 KiB input; 12 222 ms of CHILD CPU",
    kills: "balloons",
  },
  {
    name: "round-1 bypass — 16 x 3 996 chars of `@a{1%}`",
    source: Array.from({ length: 16 }, () => "@a{1%} ".repeat(571).slice(0, 3_996)).join("\n\n"),
    measured: "7 821 ms and 1 650 MB in-process; 4 895 ms of CHILD CPU; ZERO malformed in round 1",
    kills: "balloons",
  },
];

/** Every retire reason that means "a resource bound did its job". */
const BOUND_REASONS = ["pool-cpu", "pool-rss", "pool-timeout", "pool-heap"] as const;

/**
 * The two worst shapes that are LEGITIMATE and must therefore still SUCCEED.
 *
 * `cpuMs` is the CHILD CPU cost measured on this box across 13 runs each, IDLE and
 * again with the child and ten spinners pinned to a single core. The wall figures
 * moved by 7.5x-11.6x between those two conditions; these did not move at all, and
 * that is the measurement D-27-W3B-03a rests on.
 */
const WORST_ACCEPTED: { name: string; source: string; measured: string; cpuMs: string }[] = [
  {
    name: "64 KiB of `@a{1%g} ` — the worst accepted ingredient shape",
    source: "@a{1%g} ".repeat(Math.floor(65_536 / 8)),
    measured: "648 ms on the verify box; wall 351-449 ms idle, 4 096-5 085 ms starved",
    cpuMs: "328-373 ms idle, 328-373 ms starved",
  },
  {
    name: "`\"#p \" x 21845` — the worst accepted cookware shape",
    source: "#p ".repeat(21_845),
    measured: "694 ms on the verify box; wall 483-830 ms idle, 5 537-6 264 ms starved",
    cpuMs: "453-506 ms idle, 452-506 ms starved",
  },
];

afterAll(() => {
  // R4: vitest will not exit while a child lives.
  shutdownCookParsePool();
});

beforeEach(() => {
  errorSpy.mockClear();
  warnSpy.mockClear();
});

/**
 * DECLARED FIRST ON PURPOSE. Laziness is a property of a module that has not been
 * used yet, so it can only be asserted before anything else in this file parses.
 */
describe("the pool is LAZY and SHARED (D-27-W3B-10)", () => {
  it("spawns NOTHING on import — a process that never touches a `.cook` pays nothing", () => {
    expect(cookParsePoolPidsForTests()).toEqual([]);
  });

  it("spawns exactly one child on the first parse, and never exceeds the pool size", async () => {
    const tokens = await parseInPool(REALISTIC, units);

    expect(tokens).not.toBeNull();
    expect(cookParsePoolPidsForTests()).toHaveLength(1);

    // Concurrency beyond the pool size must not spawn beyond it.
    await Promise.all(Array.from({ length: 8 }, () => parseInPool(REALISTIC, units)));

    expect(cookParsePoolPidsForTests().length).toBeLessThanOrEqual(
      COOK_BOUNDS.cookParsePoolSize
    );
  });
});

describe("COOK_BOUNDS", () => {
  it("declares the W3B bounds at their calibrated defaults (D-27-W3B-03a)", () => {
    expect(COOK_BOUNDS).toEqual({
      cookParseCpuMs: 1_500,
      cookParseCpuPollMs: 25,
      cookParseWallCeilingMs: 8_000,
      cookParseRssMb: 512,
      cookParseOldSpaceMb: 256,
      cookParsePoolSize: 2,
      cookParseQueueTimeoutMs: 1_000,
      cookParseReadyTimeoutMs: 2_000,
    });
  });

  /**
   * THE MEMORY BOUND IS A BOUND ON RSS, AND ITS NAME SAYS SO (D-27-W3B-14).
   *
   * `cookParseHeapMb: 256` was described in three separate places as what "catches
   * the report-explosion family's 839 MB-1.65 GB balloon". It could not:
   * `--max-old-space-size` caps V8's OLD GENERATION and the parser allocates in
   * WASM linear memory, so the same child measured 899 MB of RSS at the instant the
   * CPU gate fired and 2 273 MB unbounded. This pins the two apart by NAME so the
   * conflation cannot come back through a rename.
   */
  it("names the V8 old-space flag for what it sets, and the memory bound for what it bounds", () => {
    expect(Object.keys(COOK_BOUNDS)).toContain("cookParseRssMb");
    expect(Object.keys(COOK_BOUNDS)).not.toContain("cookParseHeapMb");
    // The measured worst-legitimate peak is 152.9 MB and the idle plateau 175.2 MB,
    // so the memory budget must stay comfortably above the old-space flag — if it
    // ever fell below it, the flag would be unreachable and `pool-heap` dead code.
    expect(COOK_BOUNDS.cookParseRssMb).toBeGreaterThan(COOK_BOUNDS.cookParseOldSpaceMb);
    // Worst-case transient across the pool, stated as arithmetic rather than prose.
    expect(COOK_BOUNDS.cookParsePoolSize * COOK_BOUNDS.cookParseRssMb).toBe(1_024);
  });

  /**
   * The two numbers only make sense together, and getting their ORDER wrong would
   * quietly turn the wall-clock backstop back into the computation bound — which is
   * the defect D-27-W3B-03a exists to remove. Asserted, not left to review.
   */
  it("keeps the wall-clock ceiling a BACKSTOP: comfortably above the CPU budget", () => {
    expect(COOK_BOUNDS.cookParseWallCeilingMs).toBeGreaterThan(COOK_BOUNDS.cookParseCpuMs * 4);
    // 25 ms against 1 500 ms is 1.7% of overshoot, and coarse enough to fire zero
    // polls for any real recipe (~0.97 ms pooled, ~15 ms for a 64 KiB one).
    expect(COOK_BOUNDS.cookParseCpuPollMs).toBeLessThan(COOK_BOUNDS.cookParseCpuMs / 40);
  });

  it("is SEPARATE from the nine input caps — the W3B pivot changed none of them", async () => {
    const { COOK_LIMITS } = await import("../../src/cooklang/limits");

    expect(Object.keys(COOK_LIMITS)).toHaveLength(9);

    for (const key of Object.keys(COOK_BOUNDS)) {
      expect(Object.keys(COOK_LIMITS)).not.toContain(key);
    }
  });
});

describe("a real recipe round-trips through the process boundary", () => {
  /**
   * THE GUARD THAT KEEPS THE FIXTURE HONEST — declared before everything that
   * consumes it, because if this fails, ~15 assertions below are testing something
   * other than what their names claim.
   *
   * `REALISTIC` is what this file calls "a real recipe", and every latency,
   * laziness and terminate-and-replace assertion is calibrated on it. `parseInPool`
   * is the layer BELOW `findCookSourceDefect`, so a `REALISTIC` the recognizer
   * would refuse still round-trips here and nothing goes red — which is exactly how
   * the hand-written literal this replaced survived Task 3 for three commits. So
   * the property is asserted DIRECTLY, on the same recognizer the read path runs.
   */
  it("the REALISTIC fixture is a source the real recognizer accepts (not just one the pool tolerates)", () => {
    expect(findCookSourceDefect(REALISTIC)).toBeNull();
    // Minted, not quoted by hand: the emitter's own frontmatter, whatever it emits.
    expect(REALISTIC.startsWith('---\ntitle: "Weeknight Tomato Pasta"\nservings: 4\n')).toBe(true);
    // A real recipe's size class, so the latency alarm below measures a real shape.
    expect(Buffer.byteLength(REALISTIC, "utf8")).toBeLessThan(1_024);
  });

  it("produces a CookTokensSchema-valid DTO for a realistic recipe", async () => {
    const tokens = await parseInPool(REALISTIC, units);

    expect(tokens).not.toBeNull();
    expect(() => CookTokensSchema.parse(tokens)).not.toThrow();
    expect(tokens).toHaveLength(5);
    expect(tokens?.[0]?.section).toBe("Prep");
    expect(tokens?.[4]?.section).toBe("Finish");

    // PINNED CONTENT, not merely "not null" (§16.3's rule): these amounts and
    // canonical unit IDs exist ONLY because the WASM in the child derived them from
    // `@spaghetti{400%gram}` and `@olive oil{2%tablespoon}`, so this cannot pass on
    // a token stream that made the round trip but carries nothing.
    expect(tokens?.[0]?.tokens?.[1]).toEqual({
      type: "ingredient",
      name: "spaghetti",
      amount: 400,
      unit: "gram",
    });
    expect(tokens?.[1]?.tokens?.[1]).toEqual({
      type: "ingredient",
      name: "olive oil",
      amount: 2,
      unit: "tablespoon",
    });
    expect(tokens?.[2]?.tokens?.at(-1)).toEqual({
      type: "timer",
      name: null,
      amount: 1,
      unit: "minutes",
    });
  });

  /**
   * NO REGRESSION FOR REAL RECIPES. Asserted against `fixture.expected` — the
   * fixtures file's OWN declared contract for what must survive a round trip —
   * rather than against a snapshot of current behaviour, so this stays a real
   * assertion instead of a recording of whatever the code happens to do.
   */
  it.each(fixtures.map((fixture) => [fixture.slug, fixture] as const))(
    "projects every ingredient of the %s fixture with its amount and canonical unit",
    async (_slug, fixture) => {
      const source = structuredToCooklang(fixture.recipe, units);
      const tokens = await parseInPool(source, units);

      expect(tokens).not.toBeNull();
      expect(() => CookTokensSchema.parse(tokens)).not.toThrow();
      expect(tokens).toHaveLength(fixture.expected.length);

      fixture.expected.forEach((step, index) => {
        const projected = (tokens?.[index]?.tokens ?? []).filter(
          (token) => token.type === "ingredient"
        );

        expect(projected).toEqual(
          step.ingredients.map((ingredient) => ({
            type: "ingredient",
            name: ingredient.name,
            amount: ingredient.amount,
            unit: ingredient.unit,
          }))
        );
      });
    }
  );

  /**
   * WHY THIS IS NOT A WALL-CLOCK 50 ms ANY MORE (27-04-FIX-GATES §FAIL-1). It had
   * the exact D-27-W3B-03a disease R2 (below) was rewritten around, sitting 14
   * lines above that very docblock: `expect(performance.now() - startedAt).
   * toBeLessThan(50)` failed at **50.03 ms** in the full-suite run under host
   * contention, green 3/3 in isolation and green 3/3 under 8 spinners in
   * isolation — the signature of a wall-clock instrument, not a real regression.
   * Raising 50 to 100 would have been the same retune this phase already
   * rejected once; the property this test protects — a WARM pool costs the
   * SAME (near-zero) marginal work for every committed fixture, i.e. no
   * fixture-specific slow path and no per-fixture respawn — has nothing to do
   * with wall clock and everything to do with (a) the pool staying warm and
   * (b) CPU per round trip.
   *
   * (a) is asserted directly and non-vacuously: the pool's live pid SET is
   * captured before the loop and compared for referential equality after —
   * a respawn (the exact regression R2's docblock cites: "making release()
   * retire its child... turns this test RED") changes that set, with no
   * timing involved at all.
   *
   * (b) is CPU per round trip, in both processes, mirroring R2's instrument —
   * with two DIFFERENT ceilings, because the two axes have measurably
   * different noise floors on THIS box:
   *
   *  - `childCpuMs` (the child's own `/proc/<pid>/schedstat` reading, the same
   *    number the production gate decides with) is rock-stable: 0.85-1.66 ms
   *    across 8 full-package runs, isolated and under real vitest full-suite
   *    worker contention alike — this is §13.1's "CPU did not move" reproduced
   *    on the read path. 10 ms is ~6-12x that observed worst.
   *  - `parentCpuMs` (`process.cpuUsage()` on the TEST RUNNER's own process) is
   *    the noisier of the two, because under a genuine full-package run this
   *    process is itself one of several vitest workers sharing 4 cores, and
   *    V8's GC bookkeeping on a contended box does show up as this process's
   *    own consumed ticks. Measured worst observed across 8 full-`pnpm test`
   *    runs (not isolated — the exact condition that broke the old wall-clock
   *    version): 0.85-14.63 ms. A single-shot 10 ms ceiling (no averaging, unlike
   *    R2's 100-iteration mean) failed once at 10.036 ms during calibration — a
   *    real, reproduced false refusal, not a hypothetical one. 50 ms is ~3.4x
   *    that observed worst, matching this repo's own headroom convention
   *    (`cookParseRssMb`'s 2.67x, `cookParseCpuMs`'s ~3x).
   *
   * A lost-pool regression (a fresh 200-243 ms respawn) still blows through
   * both ceilings by 4-20x, and the pid-identity check above catches that
   * exact regression directly and unconditionally regardless of either number.
   */
  it("each committed fixture costs bounded CPU on a warm, UNCHANGED pool", async () => {
    // Warm first: the ~200 ms lazy spawn is a one-off and is not what this measures.
    await parseInPool(REALISTIC, units);

    const pidsBeforeLoop = cookParsePoolPidsForTests();
    const [pid] = pidsBeforeLoop;

    expect(typeof pid).toBe("number");

    for (const fixture of fixtures) {
      const source = structuredToCooklang(fixture.recipe, units);
      const childCpuBefore = cookParseChildCpuMsForTests(pid!);
      const parentCpuBefore = process.cpuUsage();

      await parseInPool(source, units);

      const parentCpuDelta = process.cpuUsage(parentCpuBefore);
      const parentCpuMs = (parentCpuDelta.user + parentCpuDelta.system) / 1_000;
      const childCpuAfter = cookParseChildCpuMsForTests(pid!);
      const childCpuMs =
        childCpuBefore === null || childCpuAfter === null ? null : childCpuAfter - childCpuBefore;

      // THE WORK, on the axis that measures the test runner's own process —
      // noisier under real multi-worker contention than the child's schedstat
      // reading below, so it gets more headroom (see the docblock above).
      expect(parentCpuMs).toBeLessThan(50);
      // `null` only on a host without `/proc/<pid>/schedstat`, which is not
      // production. This is the SAME number the production gate decides
      // with, and it is the axis §13.1 measured flat under contention.
      expect(childCpuMs ?? 0).toBeLessThan(10);
    }

    // THE POOL STAYED WARM: no fixture triggered a respawn (a real regression —
    // e.g. `release()` retiring its child — changes this set; a wall-clock
    // ceiling could only ever infer that indirectly and inconsistently).
    expect(cookParsePoolPidsForTests()).toEqual(pidsBeforeLoop);
  });

  /**
   * R2 — READ-PATH LATENCY, asserted on the axes that measure THIS CODE.
   *
   * WHY THIS IS NOT A WALL-CLOCK p50 ANY MORE. It was one, and it had the exact
   * disease D-27-W3B-03a diagnosed for the bound itself: `p50 < 5 ms` against a
   * design figure of 0.85 ms is 5.9x of headroom on a quantity that §13.1 measured
   * inflating **7.5x-11.6x under host load**. It duly passed in isolation and failed
   * in the full `@norish/shared-server` run — 5.43 ms for one agent, **9.39 ms**
   * re-measured here — because a pooled round trip's ELAPSED time is partly a
   * function of how many vitest workers are competing for four cores. Raising it to
   * 25 ms would have been the wall-clock retune this phase already rejected once, and
   * would also have retired the alarm: a per-parse respawn (200-243 ms) is the only
   * regression left that 25 ms still catches.
   *
   * So the alarm moved onto axes that measure the work and kept its teeth:
   *
   *  1. **CPU per round trip, in BOTH processes.** This is what the read path
   *     actually pays for the process boundary, and CPU was measured flat within ±3%
   *     across an order of magnitude of host load. Measured on this box: parent
   *     **1.09 ms**, child **1.15 ms** per round trip. The ceilings are ~3.7x, the
   *     same headroom rule `cookParseCpuMs` uses.
   *  2. **The FASTEST round trip of the 100, not the median.** The minimum is the
   *     standard robust estimator for a path's intrinsic latency — it is the iteration
   *     that was least interfered with, so it still reports ~1.5 ms when the median has
   *     inflated fourfold. Measured: **1.51 ms** idle. The 5 ms ceiling is R2's
   *     original number, now applied to a statistic that measures this code.
   *
   * NEITHER IS VACUOUS, and that was VERIFIED rather than argued. Making `release()`
   * retire its child — i.e. deleting the pooling, so every parse pays a fresh
   * 200-243 ms spawn — turns this test RED, together with four others, at its very
   * first assertion: after a warm-up parse there is no live child left to attribute
   * CPU to. The floor would have caught it too had it got that far, as the sibling
   * fixture round trip demonstrates in the same run (303 ms against its own 50 ms
   * ceiling). Every other regression this exists to catch — a WASM instance rebuilt
   * per parse (+15.7 ms), an extra copy of a 64 KiB payload, a lost `ready`
   * handshake — costs CPU or raises the floor by far more than 3.7x.
   */
  it("a warm round trip costs bounded CPU and has a bounded FLOOR (explicit measurement)", async () => {
    await parseInPool(REALISTIC, units);

    const [pid] = cookParsePoolPidsForTests();

    expect(typeof pid).toBe("number");

    const childCpuAtStart = cookParseChildCpuMsForTests(pid!);
    const parentCpuAtStart = process.cpuUsage();
    const elapsed: number[] = [];

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const startedAt = performance.now();

      await parseInPool(REALISTIC, units);
      elapsed.push(performance.now() - startedAt);
    }

    const parentCpu = process.cpuUsage(parentCpuAtStart);
    const childCpuAtEnd = cookParseChildCpuMsForTests(pid!);
    const parentCpuMs = (parentCpu.user + parentCpu.system) / 1_000 / elapsed.length;
    const childCpuMs =
      childCpuAtStart === null || childCpuAtEnd === null
        ? null
        : (childCpuAtEnd - childCpuAtStart) / elapsed.length;

    elapsed.sort((left, right) => left - right);

    const at = (quantile: number): number =>
      elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * quantile))] ??
      Number.POSITIVE_INFINITY;

    // ANTI-VACUITY: the loop really ran, and the floor is a real measurement.
    expect(elapsed).toHaveLength(100);
    expect(at(0)).toBeGreaterThan(0);

    // THE WORK, on the axis that does not move with host load.
    expect(parentCpuMs).toBeLessThan(4);
    // `null` only on a host without `/proc/<pid>/schedstat`, which is not production.
    expect(childCpuMs ?? 0).toBeLessThan(4);

    // THE FLOOR: the least-interfered-with iteration of the hundred.
    expect(at(0)).toBeLessThan(5);
  });

  /** D-27-W3B-11: `scale` survives the boundary, so W4 need not re-plumb it. */
  it("forwards `scale` to the WASM — 2 doubles the amounts, undefined leaves them alone", async () => {
    const source = "---\nservings: 4\n---\nAdd @flour{200%gram}.\n";

    const plain = await parseInPool(source, units);
    const doubled = await parseInPool(source, units, 2);

    expect(plain?.[0]?.tokens?.[1]).toEqual({
      type: "ingredient",
      name: "flour",
      amount: 200,
      unit: "gram",
    });
    expect(doubled?.[0]?.tokens?.[1]).toEqual({
      type: "ingredient",
      name: "flour",
      amount: 400,
      unit: "gram",
    });
  });
});

describe("THE BOUND, on the exact inputs that refuted rounds 1 and 2", () => {
  /**
   * The recognizer is not involved: `parseInPool` is the layer BELOW it. So each
   * of these passes for one reason only — the parse was bounded.
   */
  it.each(HOSTILE.map((entry) => [entry.name, entry] as const))(
    "resolves null, with the gate reporting the CPU it refused, on %s",
    async (_name, entry) => {
      const startedAt = performance.now();
      const tokens = await parseInPoolBelowTheRecognizerForTests(entry.source, units);
      const elapsed = performance.now() - startedAt;

      expect(tokens).toBeNull();

      const hit = warnSpy.mock.calls
        .map(
          (call) =>
            call[0] as {
              reason?: string;
              bound?: string;
              measured?: number | null;
              cpuMs?: number | null;
              rssMb?: number | null;
            }
        )
        .find((fields) =>
          BOUND_REASONS.includes(fields.reason as (typeof BOUND_REASONS)[number])
        );

      expect(hit).toBeDefined();

      // WHICH GATE FIRES IS A PROPERTY OF THE BOX, AND THAT IS NOT AN ACCIDENT — it
      // is arithmetic. Burning 1 500 ms of CPU takes 1 500 ms of wall clock only on an
      // idle box; §13.1 measured wall inflating 7.5x-11.6x under contention, and
      // 1 500 x 5.34 = 8 000, so **above ~5.3x of contention the WALL BACKSTOP
      // pre-empts the CPU gate** and the same hostile row is refused as
      // `pool-timeout` instead of `pool-cpu`. That was observed here: this very test
      // went red on the report-explosion row at 8 158 ms in a full run. It is not a
      // defect — the row is refused either way and costs the user nothing — but a
      // test that PINS one reason at the shipped defaults is a measurement of the
      // machine, which is exactly the mistake D-27-W3B-03a exists to stop repeating.
      //
      // So this test asserts what is true on EVERY box, and the teeth are (a) the
      // per-reason number, (b) the discrimination that a MEMORY reason cannot pass
      // for a flat-85-MB shape, and (c) proof the child was COMPUTING rather than
      // stuck. The CPU gate and the RSS gate are each pinned deterministically
      // below, with the backstop lifted out of the way.
      if (hit?.reason === "pool-cpu") {
        expect(hit?.bound).toBe("cookParseCpuMs");
        expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(COOK_BOUNDS.cookParseCpuMs);
      } else if (hit?.reason === "pool-rss") {
        // Only a shape that actually allocates can breach the memory bound. H1 was
        // measured at a flat 79-85 MB across its whole 1 505 ms parse, so this
        // branch reaching a `pure-cpu` row would mean the RSS reader is broken.
        expect(entry.kills).toBe("balloons");
        expect(hit?.bound).toBe("cookParseRssMb");
        expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(COOK_BOUNDS.cookParseRssMb);
      } else if (hit?.reason === "pool-timeout") {
        expect(hit?.bound).toBe("cookParseWallCeilingMs");
        expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(COOK_BOUNDS.cookParseWallCeilingMs);
        // NOT a stuck child: the gate had sampled real CPU before the ceiling fired.
        // A `pool-timeout` with `cpuMs` at ~0 on a hostile row would mean the CPU
        // sampler is broken, which is the failure this branch must not absorb.
        expect(hit?.cpuMs ?? 0).toBeGreaterThan(COOK_BOUNDS.cookParseCpuMs * 0.5);
      } else {
        // H1 runs at a FLAT 85 MB, so no memory bound can be what stopped it; only
        // the ballooning shapes may reach a V8 old-space abort.
        expect(entry.kills).toBe("balloons");
        expect(hit?.reason).toBe("pool-heap");
      }

      // BOTH measured axes travel on EVERY bound hit, whichever one fired — that is
      // what makes a production `pool-cpu` at 85 MB distinguishable from a
      // `pool-cpu` at 500 MB. A hostile row that ran long enough to hit a bound has
      // necessarily been sampled at least once, so neither may be `null` here.
      expect(hit?.cpuMs ?? null).not.toBeNull();
      expect(hit?.rssMb ?? null).not.toBeNull();
      // And the memory bound is never breached silently: no reported RSS may sit
      // above the budget without `pool-rss` being the reason.
      if ((hit?.rssMb ?? 0) > COOK_BOUNDS.cookParseRssMb) {
        expect(hit?.reason).toBe("pool-rss");
      }

      // All wall clock can honestly say is THAT IT DID NOT HANG. A tighter ceiling
      // here would be measuring the machine — see the file docblock.
      expect(elapsed).toBeLessThan(COOK_BOUNDS.cookParseWallCeilingMs + 2_000);
    }
  );

  /**
   * THE PARENT IS NEVER KILLED. This is the assertion that distinguishes the
   * chosen mechanism from `worker_threads` + `resourceLimits`, which was MEASURED
   * on this tree to abort the entire Node process (exit 134,
   * `v8::internal::V8::FatalProcessOutOfMemory` under `Builtin_JsonParse`) on the
   * round-1 bypass payload. If this test runs to completion at all, the parent
   * survived every one of those payloads — and its own heap is untouched, because
   * the allocation happened in a process that no longer exists.
   */
  it("leaves the PARENT process alive with its heap essentially untouched", async () => {
    const before = process.memoryUsage().heapUsed;

    // THE BALLOONING SHAPES ONLY, and that is the claim rather than a shortcut: the
    // four H1 rows run at a FLAT 6 MB, so they can contribute nothing to a
    // heap-GROWTH measurement, while each of them can hold a child for up to
    // `cookParseWallCeilingMs` on a loaded box (see the reason-arithmetic above).
    // Six of those exceeds vitest's 30 s file timeout, and a test that dies on the
    // harness timeout proves nothing — the file docblock's own rule. The parent
    // surviving all six is asserted by the sweep above, which drives every row.
    for (const entry of HOSTILE.filter((candidate) => candidate.kills === "balloons")) {
      expect(await parseInPoolBelowTheRecognizerForTests(entry.source, units)).toBeNull();
    }

    const growthMb = (process.memoryUsage().heapUsed - before) / 1_048_576;

    // The parent never sees the child's allocation. Generous, because vitest's own
    // bookkeeping moves the parent heap around; the point is orders of magnitude,
    // not megabytes: unbounded, these payloads reach 839-1 650 MB.
    expect(growthMb).toBeLessThan(64);
    expect(await parseInPool(REALISTIC, units)).not.toBeNull();
  });

  /**
   * THE CPU GATE, PINNED ON A REAL ARTEFACT AND DETERMINISTICALLY.
   *
   * This is the assertion the sweep above had to give up when it stopped pinning one
   * reason at the shipped defaults, and it is restored here without the load
   * dependence rather than dropped. The wall backstop is lifted to 60 s through its
   * env lever, so on ANY box — idle or starved — the only gate that can fire is the
   * CPU gate, and the reason, the bound name and the measured figure are pinned
   * exactly. The H1 artefact is the right input for it: 22 759 ms of CPU at a flat
   * 6 MB, so neither the heap bound nor a lucky fast parse can produce this result.
   *
   * `stub-parse-worker.mjs`'s burn mode proves the same mechanism with no WASM at
   * all; this proves it on the payload that actually refuted round 2.
   */
  it("pins the CPU gate on the H1 artefact with the wall backstop lifted (deterministic)", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WALL_CEILING_MS", "60000");
    vi.resetModules();

    const bounded = await import("../../src/cooklang/pool");

    try {
      const startedAt = performance.now();

      expect(await bounded.parseInPoolBelowTheRecognizerForTests(HOSTILE[0]!.source, units)).toBeNull();

      const hit = warnSpy.mock.calls
        .map((call) => call[0] as { reason?: string; bound?: string; measured?: number | null })
        .find((fields) => fields.reason === "pool-cpu");

      expect(hit).toBeDefined();
      expect(hit?.bound).toBe("cookParseCpuMs");
      expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(COOK_BOUNDS.cookParseCpuMs);
      // ANTI-VACUITY, and SOUND ON ANY BOX: burning 1 500 ms of CPU takes at least
      // 1 500 ms of elapsed time, so this cannot pass by refusing the input instantly.
      expect(performance.now() - startedAt).toBeGreaterThan(COOK_BOUNDS.cookParseCpuMs * 0.9);
    } finally {
      bounded.shutdownCookParsePool();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * THE MEMORY GATE, PINNED ON A REAL ARTEFACT AND DETERMINISTICALLY
   * (D-27-W3B-14 — VERIFY-3 blocker 1).
   *
   * WHAT THIS REPLACES. `cookParseHeapMb: 256` — the child's
   * `--max-old-space-size` — was billed in three places as what "catches the
   * report-explosion family's 839 MB-1.65 GB balloon". It never did:
   * `--max-old-space-size` caps V8's OLD GENERATION, and the parser allocates in
   * WASM LINEAR MEMORY, which that flag has no authority over. Re-measured on this
   * box, forking the real child exactly as `./pool` does: **899 MB of RSS at the
   * instant the 1 500 ms CPU gate fired**, **2 273 MB** if left to run. And the
   * mutation that settled it: `execArgv: []` — no heap flag at all — left the whole
   * cooklang suite green. The flag had no teeth anywhere.
   *
   * WHY THIS TEST IS DETERMINISTIC RATHER THAN LOAD-DEPENDENT. RSS and CPU are both
   * functions of the work performed, so their ORDER is arithmetic, not luck: this
   * payload was measured crossing 512 MB at **630 ms of child CPU**, 2.4x before the
   * 1 500 ms CPU budget could be spent, on every run. The one gate that could
   * pre-empt it is the 8 000 ms WALL backstop under heavy contention (§15.3), so the
   * backstop is lifted to 60 s through its env lever — exactly as the sibling
   * CPU-gate test does — and then only the memory bound can fire.
   *
   * ITS ANTI-VACUITY IS THE MEASURED FIGURE ITSELF: 512 MB is 3.3x the worst
   * LEGITIMATE peak (152.9 MB) and 2.9x the child's idle plateau (175.2 MB), so a
   * gate that fired at a number in that range would fail this test rather than pass
   * it, and a gate that never fired would leave `hit` undefined.
   */
  it("pins the MEMORY gate on the report-explosion artefact with the wall backstop lifted (deterministic)", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WALL_CEILING_MS", "60000");
    vi.resetModules();

    const memoryBounded = await import("../../src/cooklang/pool");
    const ballooning = HOSTILE.find((entry) => entry.kills === "balloons")!;

    try {
      expect(await memoryBounded.parseInPoolBelowTheRecognizerForTests(ballooning.source, units)).toBeNull();

      const hit = warnSpy.mock.calls
        .map(
          (call) =>
            call[0] as { reason?: string; bound?: string; measured?: number | null; cpuMs?: number | null }
        )
        .find((fields) => fields.reason === "pool-rss");

      expect(hit).toBeDefined();
      expect(hit?.bound).toBe("cookParseRssMb");
      expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(COOK_BOUNDS.cookParseRssMb);
      // THE OVERSHOOT IS BOUNDED BY ONE POLL INTERVAL OF ALLOCATION, measured at
      // <= 39 MB across both ballooning families. 128 MB is ~3x that, and it is what
      // makes this a BOUND rather than an observation: at 2 273 MB unbounded, an
      // ungated child would blow straight past this ceiling.
      expect(hit?.measured ?? Number.POSITIVE_INFINITY).toBeLessThan(
        COOK_BOUNDS.cookParseRssMb + 128
      );
      // IT WAS THE MEMORY GATE AND NOT THE CPU GATE IN DISGUISE: the child was
      // killed with most of its CPU budget still unspent (measured 630 ms of 1 500).
      expect(hit?.cpuMs ?? Number.POSITIVE_INFINITY).toBeLessThan(COOK_BOUNDS.cookParseCpuMs);
    } finally {
      memoryBounded.shutdownCookParsePool();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * THE BOUND MUST NOT REFUSE WHAT PARSES TODAY — AT THE SHIPPED DEFAULTS.
   *
   * The previous version of this test could not make that claim. Under
   * D-27-W3B-03's 1 000 ms WALL-CLOCK bound these two legitimate shapes were
   * measured at 1 137 ms and 1 238 ms in the full shared-server run and were
   * REFUSED, so the test had to raise the bound through its env lever and could only
   * assert the weaker "not INHERENTLY refused".
   *
   * Under D-27-W3B-03a there is no env lever and no weaker claim: the shapes are
   * asserted to parse under the DEFAULT `cookParseCpuMs`, and the headroom is
   * asserted on the CPU figure the gate actually decides with (measured 328-506 ms
   * against a 1 500 ms budget) rather than on elapsed time.
   */
  it.each(WORST_ACCEPTED.map((entry) => [entry.name, entry] as const))(
    "parses the worst ACCEPTED shape at the SHIPPED defaults, with CPU headroom: %s",
    async (_name, entry) => {
      const tokens = await parseInPool(entry.source, units);

      expect(tokens).not.toBeNull();
      expect(() => CookTokensSchema.parse(tokens)).not.toThrow();

      const cpuMs = cookParseLastCpuMsForTests();

      // NOT VACUOUS: these shapes run for hundreds of ms, so the 25 ms poll MUST
      // have sampled them. A `null` here would mean the gate never looked, and the
      // headroom assertion below would then be checking nothing.
      expect(cpuMs).not.toBeNull();
      expect(cpuMs ?? 0).toBeGreaterThan(0);

      // REAL HEADROOM, on the axis that does not move with host load.
      expect(cpuMs ?? Number.POSITIVE_INFINITY).toBeLessThan(COOK_BOUNDS.cookParseCpuMs * 0.6);

      // AND THE SAME CLAIM ON THE MEMORY AXIS (D-27-W3B-14). These shapes were
      // measured peaking at 120.3 MB and 152.9 MB against a 512 MB budget; the
      // child's own idle plateau is 175.2 MB. Anything that made a legitimate parse
      // approach the memory bound — a copy of the payload, a leak, a raised
      // `maxCookSourceBytes` without re-measuring — fails here BEFORE it can start
      // refusing real recipes in production.
      const rssMb = cookParseLastRssMbForTests();

      expect(rssMb).not.toBeNull();
      expect(rssMb ?? 0).toBeGreaterThan(0);
      expect(rssMb ?? Number.POSITIVE_INFINITY).toBeLessThan(COOK_BOUNDS.cookParseRssMb * 0.6);
    }
  );
});

/**
 * THE NEVER-BROKEN PROPERTY MUST HOLD UNDER CONTENTION — D-27-W3B-03a's whole
 * reason for existing. Two tests, because the claim has two halves and only one of
 * them can be proven without involving the host scheduler.
 */
describe("NEVER-BROKEN UNDER CONTENTION (D-27-W3B-03a)", () => {
  /**
   * HALF ONE — THE MECHANISM, PROVEN DETERMINISTICALLY.
   *
   * A stub child that sleeps for 3 000 ms burns essentially no CPU. D-27-W3B-03's
   * 1 000 ms wall-clock bound would have killed it at 1 000 ms; a CPU gate must not
   * touch it. This is the CPU-versus-wall-clock distinction with the scheduler taken
   * completely out of the picture — no load to manufacture, nothing to flake.
   */
  it("does NOT refuse a parse that elapses 3 s of WALL CLOCK while burning no CPU", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WORKER_PATH", STUB_WORKER);
    vi.stubEnv("STUB_MODE", "sleep");
    vi.stubEnv("STUB_MS", "3000");
    vi.resetModules();

    const sleeping = await import("../../src/cooklang/pool");

    try {
      const startedAt = performance.now();
      const tokens = await sleeping.parseInPool("Add @flour{200%gram}.\n", units);
      const elapsed = performance.now() - startedAt;

      // The parse SUCCEEDED, and the stub's own step came back — so this is a real
      // round trip and not an accidental `null` that happens to look like success.
      expect(tokens).not.toBeNull();
      expect(tokens?.[0]?.tokens?.[1]).toEqual({
        type: "ingredient",
        name: "flour",
        amount: 200,
        unit: "gram",
      });

      // ANTI-VACUITY: it really did elapse past the superseded 1 000 ms bound. If
      // the stub had replied immediately this assertion would fail and the test
      // could not pass by proving nothing.
      expect(elapsed).toBeGreaterThan(SUPERSEDED_WALL_BOUND_MS);
      expect(elapsed).toBeGreaterThan(2_900);

      // And no bound was logged at all.
      const reasons = warnSpy.mock.calls.map((call) => (call[0] as { reason?: string })?.reason);

      for (const reason of BOUND_REASONS) expect(reasons).not.toContain(reason);
    } finally {
      sleeping.shutdownCookParsePool();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * THE OTHER DIRECTION, and it is what stops the test above from being a licence to
   * do nothing: a stub that BLOCKS its event loop burning CPU — exactly as the
   * synchronous WASM parse does, so no timer inside it could ever rescue it — must be
   * killed once the budget is spent, and the gate must report the CPU it measured.
   */
  it("DOES refuse a parse that burns CPU past the budget, and says how much", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WORKER_PATH", STUB_WORKER);
    vi.stubEnv("STUB_MODE", "burn");
    vi.stubEnv("STUB_MS", "6000");
    vi.resetModules();

    const burning = await import("../../src/cooklang/pool");

    try {
      const tokens = await burning.parseInPool("Add @flour{200%gram}.\n", units);

      expect(tokens).toBeNull();

      const hit = warnSpy.mock.calls
        .map((call) => call[0] as { reason?: string; bound?: string; measured?: number | null })
        .find((fields) => fields.reason === "pool-cpu");

      expect(hit).toBeDefined();
      expect(hit?.bound).toBe("cookParseCpuMs");
      expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(COOK_BOUNDS.cookParseCpuMs);
      // The 25 ms poll must not have overshot by more than one interval plus slack.
      expect(hit?.measured ?? 0).toBeLessThan(COOK_BOUNDS.cookParseCpuMs + 200);
    } finally {
      burning.shutdownCookParsePool();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * HALF TWO — THE REAL SHAPES, ON A REALLY LOADED BOX.
   *
   * WHAT THIS ASSERTS, AND WHAT IT DOES NOT. It spawns `2 x availableParallelism()`
   * busy-loop processes and then parses BOTH worst legitimate shapes with the real
   * WASM child. It asserts three things:
   *
   *  1. Both shapes still parse. That is the never-broken property under load.
   *  2. The CPU the gate measured stayed inside 60% of the budget — the number that
   *     is invariant to whatever else the box is doing.
   *  3. THE CONTENTION WAS REAL, twice over: the wall/CPU ratio diverged by at least
   *     1.5x, and at least one shape elapsed past the superseded 1 000 ms wall-clock
   *     bound — i.e. would have been REFUSED by D-27-W3B-03 and is not now.
   *
   * (3) is what keeps this from being a green test that proves nothing: if the
   * spinners fail to bite, the ratio assertion FAILS rather than passing quietly.
   *
   * It does NOT assert any particular elapsed time, because that is a property of the
   * host and not of this code. It also does not claim to reproduce the exact 20-worker
   * vitest contention from 27-04-SUMMARY §3b; it manufactures its own, which measured
   * HARSHER (7.5x-11.6x wall inflation against §3b's ~2.5x).
   */
  it("parses BOTH worst legitimate shapes while the box is saturated with spinners", async () => {
    const spinners: ChildProcess[] = [];
    /**
     * 3x the core count is calibrated, not picked: it leaves the parse child roughly
     * a quarter of a core, which on the measured CPU costs (328-506 ms) puts elapsed
     * time at ~1.3-2.0 s — past the superseded 1 000 ms bound with margin, and still
     * ~4x under `cookParseWallCeilingMs` so the BACKSTOP cannot fire and turn this
     * into a flaky test in the full run.
     */
    const spinnerCount = Math.max(6, availableParallelism() * 3);

    // Warm the pool BEFORE loading the box, so a cold spawn is not what is measured.
    expect(await parseInPool(REALISTIC, units)).not.toBeNull();

    for (let index = 0; index < spinnerCount; index += 1) {
      spinners.push(
        fork(STUB_WORKER, [], {
          env: { ...process.env, STUB_MODE: "burn", STUB_MS: "45000" },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          serialization: "json",
        })
      );
    }

    try {
      // Each spinner blocks its own event loop for 45 s the moment it is asked.
      for (const spinner of spinners) spinner.send({ id: 1, src: "x" });

      // Let the scheduler actually get loaded before measuring.
      await new Promise((done) => setTimeout(done, 500));

      const observed: { name: string; wallMs: number; cpuMs: number }[] = [];

      for (const entry of WORST_ACCEPTED) {
        const startedAt = performance.now();
        const tokens = await parseInPool(entry.source, units);
        const wallMs = performance.now() - startedAt;
        const cpuMs = cookParseLastCpuMsForTests();

        // (1) THE NEVER-BROKEN PROPERTY, under load.
        expect(tokens).not.toBeNull();
        expect(() => CookTokensSchema.parse(tokens)).not.toThrow();

        // (2) Decided on the contention-invariant axis, with headroom.
        expect(cpuMs).not.toBeNull();
        expect(cpuMs ?? Number.POSITIVE_INFINITY).toBeLessThan(
          COOK_BOUNDS.cookParseCpuMs * 0.6
        );

        observed.push({ name: entry.name, wallMs, cpuMs: cpuMs ?? 0 });
      }

      // (3) THE CONTENTION WAS REAL — otherwise (1) and (2) prove nothing.
      const worstRatio = Math.max(...observed.map((row) => row.wallMs / row.cpuMs));
      const worstWall = Math.max(...observed.map((row) => row.wallMs));

      expect(worstRatio).toBeGreaterThan(1.5);
      expect(worstWall).toBeGreaterThan(SUPERSEDED_WALL_BOUND_MS);
    } finally {
      for (const spinner of spinners) spinner.kill("SIGKILL");
    }
  });
});

/**
 * THE WALL-CLOCK BACKSTOP, RE-PROVEN UNDER THE NEW GATE. It is no longer the
 * computation bound, but it is still the only thing that catches a child stuck
 * WITHOUT burning CPU — a hang, a lost IPC reply, a child descheduled forever — and
 * the CPU gate is structurally blind to that case because the counter never advances.
 *
 * Proven with the SLEEPING stub (zero CPU, unbounded wall clock) and the ceiling
 * lowered through its supported env lever, so the mechanism is exercised in 1.2 s
 * instead of 8. The value being 8 000 ms in production is asserted separately in the
 * `COOK_BOUNDS` block; what is proven here is that the backstop FIRES, retires the
 * child, and costs the user nothing.
 */
describe("THE WALL-CLOCK BACKSTOP catches a child stuck WITHOUT burning CPU", () => {
  it("resolves null with reason pool-timeout, and the next parse still succeeds", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WORKER_PATH", STUB_WORKER);
    vi.stubEnv("STUB_MODE", "sleep");
    vi.stubEnv("STUB_MS", "30000");
    vi.stubEnv("NORISH_COOK_PARSE_WALL_CEILING_MS", "1200");
    vi.resetModules();

    const stuck = await import("../../src/cooklang/pool");

    try {
      const startedAt = performance.now();
      const pending = stuck.parseInPool("Add @flour{200%gram}.\n", units);

      // Identify the doomed child WHILE it is stuck, so terminate-and-replace can be
      // asserted against a known pid rather than inferred.
      await new Promise((done) => setTimeout(done, 400));

      const doomed = stuck.cookParsePoolPidsForTests();

      expect(doomed).toHaveLength(1);

      const tokens = await pending;
      const elapsed = performance.now() - startedAt;

      expect(tokens).toBeNull();

      // ANTI-VACUITY: it waited out the ceiling rather than failing at the door.
      expect(elapsed).toBeGreaterThan(1_100);
      // And it did NOT wait out the child's 30 s sleep.
      expect(elapsed).toBeLessThan(10_000);

      const hit = warnSpy.mock.calls
        .map((call) => call[0] as { reason?: string; bound?: string; measured?: number | null })
        .find((fields) => fields.reason === "pool-timeout");

      expect(hit).toBeDefined();
      expect(hit?.bound).toBe("cookParseWallCeilingMs");
      expect(hit?.measured ?? 0).toBeGreaterThanOrEqual(1_200);

      // TERMINATE AND REPLACE (D-27-W3B-10) holds for the backstop too: the stuck
      // pid is gone from the pool the moment the ceiling fired.
      expect(stuck.cookParsePoolPidsForTests()).not.toContain(doomed[0]);
    } finally {
      stuck.shutdownCookParsePool();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("TERMINATE AND REPLACE — a bounded-out child is never reused", () => {
  /**
   * Deterministic by construction: the pool is torn down first and warmed with a
   * single sequential parse, so there is EXACTLY ONE child and the pid that serves
   * the bound-hitting request is known rather than inferred.
   */
  async function warmToExactlyOneChild(): Promise<number> {
    shutdownCookParsePool();

    expect(await parseInPool(REALISTIC, units)).not.toBeNull();

    const pids = cookParsePoolPidsForTests();

    expect(pids).toHaveLength(1);

    return pids[0]!;
  }

  it("retires the exact pid that hit the bound, and the next call still succeeds", async () => {
    const doomed = await warmToExactlyOneChild();
    const hostile = HOSTILE[0]!;

    expect(await parseInPoolBelowTheRecognizerForTests(hostile.source, units)).toBeNull();

    // Gone from the pool the moment the bound fired — not merely "eventually".
    expect(cookParsePoolPidsForTests()).not.toContain(doomed);

    const recovered = await parseInPool(REALISTIC, units);

    expect(recovered).not.toBeNull();
    expect(() => CookTokensSchema.parse(recovered)).not.toThrow();

    const serving = cookParsePoolPidsForTests();

    expect(serving).toHaveLength(1);
    expect(serving).not.toContain(doomed);
    expect(serving[0]).not.toBe(doomed);
  });

  it("survives a child killed EXTERNALLY mid-flight and answers with null", async () => {
    const doomed = await warmToExactlyOneChild();
    const hostile = HOSTILE[0]!;
    const pending = parseInPoolBelowTheRecognizerForTests(hostile.source, units);

    // The H1 payload parses for 24-38 s, so 150 ms in it is reliably mid-flight —
    // this exercises the crash path, NOT the time bound.
    await new Promise((done) => setTimeout(done, 150));
    process.kill(doomed, "SIGKILL");

    expect(await pending).toBeNull();
    expect(cookParsePoolPidsForTests()).not.toContain(doomed);
    expect(await parseInPool(REALISTIC, units)).not.toBeNull();
  });
});

describe("SATURATION DEGRADES, IT NEVER HANGS (R3, T-27-01d)", () => {
  it("resolves every one of poolSize + 4 concurrent bound-hitting requests", async () => {
    const concurrency = COOK_BOUNDS.cookParsePoolSize + 4;
    const hostile = HOSTILE[0];
    const startedAt = performance.now();

    const results = await Promise.all(
      Array.from({ length: concurrency }, () => parseInPoolBelowTheRecognizerForTests(hostile!.source, units))
    );

    const elapsed = performance.now() - startedAt;

    expect(results).toHaveLength(concurrency);
    expect(results.every((result) => result === null)).toBe(true);

    // Bounded queue + bounded parse. NONE of them may hang. The ceiling is the sum
    // of the two bounds actually on this path: the queue wait, then the CPU gate.
    // (The 8 000 ms wall backstop cannot be reached — these payloads burn CPU, so the
    // gate above kills each child at 1 500 ms of it.)
    expect(elapsed).toBeLessThan(
      COOK_BOUNDS.cookParseQueueTimeoutMs + COOK_BOUNDS.cookParseCpuMs * 2 + 3_000
    );

    // And the pool still works afterwards.
    expect(await parseInPool(REALISTIC, units)).not.toBeNull();
  });
});

describe("LOGS CARRY COUNTS, CODES AND A PID — NEVER PROSE (T-27-05)", () => {
  it("logs a bound hit with reason/bound/limit/measured/cpuMs/rssMb/elapsedMs/bytes/pid and no recipe text", async () => {
    // The H1 shape, carrying distinctive prose and an ingredient name so the
    // absence assertions below have something real to look for.
    const source = `---\ntitle: "Grandmother's Secret Cassoulet"\na: ${"[".repeat(
      65_000
    )}\n---\nFold the @duck confit{2%gram} into the beans.\n`;

    expect(await parseInPoolBelowTheRecognizerForTests(source, units)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    const boundCall = warnSpy.mock.calls.find(
      (call) => (call[0] as { reason?: string })?.reason === "pool-cpu"
    );

    expect(boundCall).toBeDefined();
    expect(boundCall?.[0]).toMatchObject({
      module: "cooklang",
      reason: "pool-cpu",
      bound: "cookParseCpuMs",
      limit: COOK_BOUNDS.cookParseCpuMs,
    });
    // `measured` and `cpuMs` are what an operator needs to tell "this row is 20x over
    // budget" from "this row is marginal", and they are what makes a `pool-cpu` rate
    // in production actionable rather than just alarming.
    expect((boundCall?.[0] as { measured: number }).measured).toBeGreaterThanOrEqual(
      COOK_BOUNDS.cookParseCpuMs
    );
    expect((boundCall?.[0] as { cpuMs: number }).cpuMs).toBeGreaterThanOrEqual(
      COOK_BOUNDS.cookParseCpuMs
    );
    // `rssMb` travels beside `cpuMs` on EVERY bound hit, including a CPU one: an
    // operator seeing `pool-cpu` needs to know whether the child was also near the
    // memory budget. This shape is measured FLAT at 79-85 MB, which is exactly why
    // the CPU gate — not the memory gate — is what refuses it.
    expect((boundCall?.[0] as { rssMb: number }).rssMb).toBeGreaterThan(0);
    expect((boundCall?.[0] as { rssMb: number }).rssMb).toBeLessThan(
      COOK_BOUNDS.cookParseRssMb
    );
    expect((boundCall?.[0] as { elapsedMs: number }).elapsedMs).toBeGreaterThan(0);
    expect((boundCall?.[0] as { bytes: number }).bytes).toBe(
      Buffer.byteLength(source, "utf8")
    );
    expect((boundCall?.[0] as { pid: number }).pid).toBeGreaterThan(0);

    const serialized = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);

    expect(serialized).not.toContain("Grandmother");
    expect(serialized).not.toContain("Cassoulet");
    expect(serialized).not.toContain("duck confit");
    expect(serialized).not.toContain("Fold the");
    expect(serialized).not.toContain("[[[[");
  });

  it("logs saturation with a reason and no source text", async () => {
    const hostile = HOSTILE[0];

    await Promise.all(
      Array.from({ length: COOK_BOUNDS.cookParsePoolSize + 4 }, () =>
        parseInPoolBelowTheRecognizerForTests(hostile!.source, units)
      )
    );

    const saturated = warnSpy.mock.calls.filter(
      (call) => (call[0] as { reason?: string })?.reason === "pool-saturated"
    );

    expect(saturated.length).toBeGreaterThan(0);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("[[[[");
  });
});

/**
 * EXACTLY ONE IMPORTER OF THE WASM BINARY.
 *
 * A static assertion, walked over the real tree rather than trusted to review, so
 * the count cannot drift silently. If someone adds a second importer, the parse
 * they add is OUTSIDE the bound and outside the two doors — which is precisely the
 * regression this whole plan exists to make impossible.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Every `.ts`/`.tsx` file under `packages/` and `apps/`, walked over the REAL tree
 * rather than derived from an import graph, so nothing can hide behind a dynamic
 * specifier. `kind: "source"` skips `__tests__` and `*.test.ts`; `kind: "test"`
 * keeps only `*.test.ts` / `*.spec.ts`.
 */
function repoFiles(kind: "source" | "test"): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
      if (entry === ".cache" || entry === ".next") continue;
      if (kind === "source" && entry === "__tests__") continue;

      const full = join(dir, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (!/\.tsx?$/.test(entry)) continue;

      const isTest = /\.(test|spec)\.tsx?$/.test(entry);

      if (kind === "test" ? isTest : !isTest) found.push(full);
    }
  };

  walk(join(repoRoot, "packages"));
  walk(join(repoRoot, "apps"));

  return found;
}

/** The repo-relative paths of every file in `kind` whose text matches `pattern`. */
function filesMatching(kind: "source" | "test", pattern: RegExp): string[] {
  return repoFiles(kind)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(repoRoot, file))
    .sort();
}

describe("`@cooklang/cooklang` is imported by exactly ONE source file", () => {
  it("names the importer, so the number cannot drift silently", () => {
    const importers = filesMatching("source", /from\s+["']@cooklang\/cooklang["']/);

    // EXACTLY ONE. Not "one plus the old one": `parse.ts` reaches the parser only
    // through the pool now, so a second entry in this list means someone opened a
    // path to the WASM that is outside the bound AND outside the two doors.
    expect(importers).toEqual(["packages/shared-server/src/cooklang/parse-worker.ts"]);
  });

  /**
   * TEST-FILE importers are enumerated too, and JUSTIFIED ONE BY ONE. Excluding
   * `__tests__` from the sweep above would let a second importer appear in a test
   * without anyone noticing, and a test that reaches the WASM directly is outside
   * the bound — legitimate for an independent oracle, not for anything else.
   */
  it("names the TEST-file importers, each with a stated reason", () => {
    const testImporters = filesMatching("test", /from\s+["']@cooklang\/cooklang["']/);

    // JUSTIFICATION, the only one on this list:
    // `round-trip.test.ts` constructs the real `CooklangParser` itself, on purpose.
    // It is the INDEPENDENT ORACLE for the serializer -> parser -> projection
    // contract: if it went through `parseCookSource` it would be checking our own
    // pool against itself. Being outside the bound is acceptable in a test whose
    // inputs are the five committed fixtures, and it is what keeps the round-trip
    // suite from becoming self-referential.
    expect(testImporters).toEqual(["packages/shared-server/__tests__/cooklang/round-trip.test.ts"]);
  });

  it("the child entry imports NOTHING from `@norish/*` at runtime", () => {
    // Established empirically: the pool forks this file as a raw `.ts`, and raw
    // Node cannot load `@norish/*` source because those packages use extensionless
    // relative imports (`./unit-form-selector`), which ESM refuses. A value import
    // added here would break the pool in dev and in vitest — and in production it
    // would break silently, degrading every parse to `null`.
    const child = readFileSync(
      join(repoRoot, "packages/shared-server/src/cooklang/parse-worker.ts"),
      "utf8"
    );

    const valueImports = [...child.matchAll(/^import\s+(?!type\s)(.*?)from\s+["'](.+?)["']/gms)];

    expect(valueImports.map((match) => match[2])).toEqual(["@cooklang/cooklang"]);
  });
});

/**
 * THE POOL IS NOT A THIRD DOOR — D-27-W3B-15, VERIFY-3 blocker 4.
 *
 * The one-importer assertions above cover `@cooklang/cooklang` itself. They do NOT
 * cover THIS MODULE, and that gap was the defect: `./cooklang/pool` was a PUBLIC
 * subpath of `@norish/shared-server`, it carried no byte cap and no recognizer of
 * its own, and the "only `./parse` may call it" rule lived in a comment. One
 * legitimate caller and nothing stopping a second.
 *
 * Three assertions, deliberately independent, because each closes a different half
 * of the hole: the subpath is gone, the production caller list is pinned, and the
 * below-the-recognizer entry's callers are enumerated and justified. The style is
 * the one above — walk the REAL tree, name the files, so drift fails a test rather
 * than review.
 */
describe("`./cooklang/pool` is reachable only through `./cooklang/parse` (D-27-W3B-15)", () => {
  it("is NOT an exported subpath of @norish/shared-server", () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "packages/shared-server/package.json"), "utf8")
    ) as { exports: Record<string, string> };

    // The door is exported; the room behind it is not. Re-adding this entry would
    // make `parseInPool` importable from `@norish/api`, `@norish/queue`,
    // `@norish/trpc` and `apps/web` again.
    expect(Object.keys(manifest.exports)).not.toContain("./cooklang/pool");
    expect(manifest.exports["./cooklang/parse"]).toBe("./src/cooklang/parse.ts");
  });

  it("names every PRODUCTION file that imports the pool module", () => {
    const importers = filesMatching("source", /from\s+["'][^"']*\/pool["']/);

    // EXACTLY ONE, and it is the door. `./build-payload` and `./attach-tokens`
    // reach the parser through `./parse`; a second entry here means a code path to
    // the WASM that skips the byte cap and the recognizer.
    expect(importers).toEqual(["packages/shared-server/src/cooklang/parse.ts"]);
  });

  /**
   * TEST-FILE importers are enumerated too, for the same reason the WASM sweep
   * enumerates its own: leaving them out would let a second caller appear inside a
   * test without anyone noticing. Every entry here is IN `@norish/shared-server`
   * and reaches the module by relative path — no package outside can, because the
   * subpath is gone.
   */
  it("names every TEST file that imports the pool module, and none is outside this package", () => {
    const importers = filesMatching("test", /from\s+["'][^"']*\/pool["']/);

    // All eight are the cooklang suites, and seven of them import only
    // `shutdownCookParsePool` — vitest will not exit while a child process lives
    // (R4). `pool.test.ts` is the pool's own suite.
    expect(importers).toEqual([
      "packages/shared-server/__tests__/cooklang/attach-tokens.test.ts",
      "packages/shared-server/__tests__/cooklang/build-payload.test.ts",
      "packages/shared-server/__tests__/cooklang/limits.test.ts",
      "packages/shared-server/__tests__/cooklang/parse.test.ts",
      "packages/shared-server/__tests__/cooklang/pool.test.ts",
      "packages/shared-server/__tests__/cooklang/round-trip-fidelity.test.ts",
      "packages/shared-server/__tests__/cooklang/round-trip.test.ts",
    ]);

    for (const file of importers) {
      expect(file.startsWith("packages/shared-server/")).toBe(true);
    }
  });

  /**
   * The below-the-recognizer entry is the one thing in this module that can reach
   * the WASM with a source `findCookSourceDefect` would refuse. It exists for the
   * bound-only proofs and for nothing else, so its callers are enumerated by name.
   */
  it("names every caller of the below-the-recognizer entry, each with a stated reason", () => {
    const pattern = /parseInPoolBelowTheRecognizerForTests/;
    const sources = filesMatching("source", pattern);
    const tests = filesMatching("test", pattern);

    // Its DECLARATION is the only production occurrence: no production code calls
    // it, and the export exists purely so the two suites below can.
    expect(sources).toEqual(["packages/shared-server/src/cooklang/pool.ts"]);

    // JUSTIFICATIONS, one per entry:
    //  - `limits.test.ts` drives the three H2 `RuntimeError: unreachable` trap
    //    shapes past the recognizer, to prove the CHILD BOUNDARY contains them and
    //    not merely that the recognizer refuses them (§14.2);
    //  - `pool.test.ts` drives the H1 family, the report explosion and the round-1
    //    bypass past it, which is the entire point of this file — a bound proven
    //    only on inputs the recognizer already refuses proves nothing about the
    //    bound.
    expect(tests).toEqual([
      "packages/shared-server/__tests__/cooklang/limits.test.ts",
      "packages/shared-server/__tests__/cooklang/pool.test.ts",
    ]);
  });

  /**
   * AND THE DOOR REALLY ENFORCES, which is what makes the list above a boundary
   * rather than a naming convention. Both preconditions are asserted on the
   * function itself, with no `./parse` in front of it.
   */
  it("refuses a source the recognizer rejects, and one over the byte cap, without spawning", async () => {
    const pidsBefore = cookParsePoolPidsForTests();

    // The H1 artefact: `findCookSourceDefect` refuses it, so the door must too.
    expect(await parseInPool(HOSTILE[0]!.source, units)).toBeNull();
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          (call[0] as { reason?: string; door?: string })?.reason === "not-serializer-shaped" &&
          (call[0] as { door?: string })?.door === "pool"
      )
    ).toBe(true);

    errorSpy.mockClear();

    // Over the byte cap, and otherwise perfectly serializer-shaped, so ONLY the
    // cap can refuse it. `boundedParse` applies it to BOTH entries, so the
    // below-the-recognizer door cannot bypass it either.
    const oversize = "Mix @flour{1%gram}.\n".repeat(4_000);

    expect(Buffer.byteLength(oversize, "utf8")).toBeGreaterThan(65_536);
    expect(findCookSourceDefect(oversize)).toBeNull();
    expect(await parseInPoolBelowTheRecognizerForTests(oversize, units)).toBeNull();
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          (call[0] as { reason?: string })?.reason === "input-too-large" &&
          (call[0] as { limit?: string })?.limit === "maxCookSourceBytes" &&
          (call[0] as { door?: string })?.door === "pool"
      )
    ).toBe(true);

    // NEITHER refusal cost a child: both are decided before `acquire()`.
    expect(cookParsePoolPidsForTests()).toEqual(pidsBefore);
  });
});

/**
 * NO CHILD, NO CRASH. The pool must degrade when it cannot get a working child at
 * all — that is the failure mode of a mis-packaged bundle (T-27-09), and it must
 * cost the user nothing rather than 500 a recipe page.
 *
 * A separate module registry, because the entry path is resolved at spawn time and
 * this pool must not inherit or pollute the one the rest of the file uses.
 */
describe("A CHILD THAT WILL NOT SPAWN COSTS THE USER NOTHING", () => {
  it("resolves null, does not throw, and logs at error level", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WORKER_PATH", "/nonexistent/cook-parse-worker.mjs");
    vi.resetModules();

    const broken = await import("../../src/cooklang/pool");

    try {
      const startedAt = performance.now();
      const tokens = await broken.parseInPool(REALISTIC, units);

      expect(tokens).toBeNull();
      expect(performance.now() - startedAt).toBeLessThan(
        COOK_BOUNDS.cookParseQueueTimeoutMs + 2_000
      );
      expect(errorSpy).toHaveBeenCalled();
      expect(
        errorSpy.mock.calls.some(
          (call) => (call[0] as { reason?: string })?.reason === "pool-spawn-failed"
        )
      ).toBe(true);
    } finally {
      broken.shutdownCookParsePool();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
