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
 * EVERY TIMING ASSERTION HERE MEASURES ELAPSED WALL-CLOCK TIME EXPLICITLY, and
 * never leans on vitest's own timeout. A test that dies on the harness timeout
 * proves nothing about the bound: it proves the harness has a timeout.
 *
 * THE ASSERTIONS WITH THE MOST TEETH are the ones fed inputs that were MEASURED
 * to cost 6-38 seconds or gigabytes of RSS in-process. They are also fed WITHOUT
 * any help from `findCookSourceDefect` — this module is the layer BELOW the
 * recognizer, so nothing here can pass because a recognizer refused the input.
 * That is deliberate and it is the whole point of the pivot.
 */

import type { UnitsMap } from "@norish/config/zod/server-config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import defaultUnits from "@norish/config/units.default.json";
import { CookTokensSchema } from "@norish/shared/contracts/zod";
import { structuredToCooklang } from "@norish/shared/cooklang";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";
import { COOK_BOUNDS } from "../../src/cooklang/limits";
import {
  cookParsePoolPidsForTests,
  parseInPool,
  shutdownCookParsePool,
} from "../../src/cooklang/pool";

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
 * committed fixtures serialize to 225-506 B). This is the shape whose latency
 * matters, because it is the shape a real read path parses.
 *
 * BLANK-LINE SEPARATED, exactly as `structuredToCooklang` emits: in Cooklang a
 * step ends at a blank line, so consecutive non-blank lines are ONE step. Writing
 * this fixture without the blank lines produced two steps instead of five and is
 * worth recording — a hand-written `.cook` in a test is easy to get wrong in a way
 * that quietly weakens whatever it was meant to prove.
 */
const REALISTIC = `---
title: Weeknight Tomato Pasta
servings: 4
---
== Prep ==

Bring a large pot of salted water to a boil, then add @spaghetti{400%gram}.

Meanwhile warm @olive oil{2%tablespoon} in a pan over medium heat.

Add @garlic{3%clove} and cook until fragrant, about ~{1%minute}.

== Finish ==

Stir in @canned tomatoes{800%gram} and simmer ~{15%minute}.

Season with @salt{1%teaspoon} and @black pepper{1%teaspoon}, then toss with @basil{10%gram}.
`;

/**
 * THE EXACT ARTEFACTS THAT REFUTED ROUND 2, plus round 1's bypass.
 *
 * Every `measured` figure is what the input cost the IN-PROCESS parse on this
 * tree. They are recorded here because they are the reason each assertion below
 * has teeth: without the bound, each of these inputs holds a request-serving
 * thread for seconds, or balloons a heap into the gigabytes.
 */
const HOSTILE: { name: string; source: string; measured: string }[] = [
  {
    name: "H1 — 65 400 unbalanced `[` in frontmatter",
    source: `---\na: ${"[".repeat(65_400)}\n---\nstep\n`,
    measured: "24 557 ms / 38 511 ms in-process, 131 218-byte report, flat 6 MB",
  },
  {
    name: "H1 — balanced 25 000-deep `[`/`]` in frontmatter",
    source: `---\na: ${"[".repeat(25_000)}${"]".repeat(25_000)}\n---\nstep\n`,
    measured: "4 838 ms in-process",
  },
  {
    name: "H1 — balanced 30 000-deep `[`/`]` in frontmatter",
    source: `---\na: ${"[".repeat(30_000)}${"]".repeat(30_000)}\n---\nstep\n`,
    measured: "8 256 ms in-process",
  },
  {
    name: "H1 — `{`-nesting variant in frontmatter",
    source: `---\na: ${"{".repeat(30_000)}${"}".repeat(30_000)}\n---\nstep\n`,
    measured: "10 489 ms in-process",
  },
  {
    name: "report explosion — `\"#\" x 8192` (8 KiB IN, 839 MB peak)",
    source: "#".repeat(8_192),
    measured: "839 MB peak RSS in-process from an 8 KiB input",
  },
  {
    name: "round-1 bypass — 16 x 3 996 chars of `@a{1%}`",
    source: Array.from({ length: 16 }, () => "@a{1%} ".repeat(571).slice(0, 3_996)).join("\n\n"),
    measured: "7 821 ms and 1 650 MB RSS in-process; scored ZERO malformed by round 1",
  },
];

/** The two worst shapes that are LEGITIMATE and must therefore still SUCCEED. */
const WORST_ACCEPTED: { name: string; source: string; measured: string }[] = [
  {
    name: "64 KiB of `@a{1%g} ` — the worst accepted ingredient shape",
    source: "@a{1%g} ".repeat(Math.floor(65_536 / 8)),
    measured: "648 ms on the verify box",
  },
  {
    name: "`\"#p \" x 21845` — the worst accepted cookware shape",
    source: "#p ".repeat(21_845),
    measured: "694 ms on the verify box",
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
  it("declares the four W3B bounds at their calibrated defaults", () => {
    expect(COOK_BOUNDS).toEqual({
      cookParseTimeoutMs: 1_000,
      cookParseHeapMb: 256,
      cookParsePoolSize: 2,
      cookParseQueueTimeoutMs: 1_000,
    });
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
  it("produces a CookTokensSchema-valid DTO for a realistic recipe", async () => {
    const tokens = await parseInPool(REALISTIC, units);

    expect(tokens).not.toBeNull();
    expect(() => CookTokensSchema.parse(tokens)).not.toThrow();
    expect(tokens).toHaveLength(5);
    expect(tokens?.[0]?.section).toBe("Prep");
    expect(tokens?.[4]?.section).toBe("Finish");
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

  it("each committed fixture completes in under 50 ms once the pool is warm", async () => {
    // Warm first: the ~200 ms lazy spawn is a one-off and is not what this measures.
    await parseInPool(REALISTIC, units);

    for (const fixture of fixtures) {
      const source = structuredToCooklang(fixture.recipe, units);
      const startedAt = performance.now();

      await parseInPool(source, units);

      expect(performance.now() - startedAt).toBeLessThan(50);
    }
  });

  /**
   * R2 — READ-PATH LATENCY. Measured design figures: in-process p50 0.615 ms
   * against a pooled IPC round trip of p50 0.847 ms, i.e. +0.23 ms on a
   * `recipes.get` that already makes several Postgres round trips. The 5 ms
   * assertion is deliberately loose: it is a REGRESSION ALARM, not a flake.
   */
  it("warm p50 round trip is under 5 ms over 100 iterations (explicit measurement)", async () => {
    await parseInPool(REALISTIC, units);

    const elapsed: number[] = [];

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const startedAt = performance.now();

      await parseInPool(REALISTIC, units);
      elapsed.push(performance.now() - startedAt);
    }

    elapsed.sort((left, right) => left - right);

    const p50 = elapsed[Math.floor(elapsed.length * 0.5)] ?? Number.POSITIVE_INFINITY;

    expect(p50).toBeLessThan(5);
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
    "resolves null in under 1 500 ms on %s",
    async (_name, entry) => {
      const startedAt = performance.now();
      const tokens = await parseInPool(entry.source, units);
      const elapsed = performance.now() - startedAt;

      expect(tokens).toBeNull();
      expect(elapsed).toBeLessThan(1_500);
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

    for (const entry of HOSTILE) {
      expect(await parseInPool(entry.source, units)).toBeNull();
    }

    const growthMb = (process.memoryUsage().heapUsed - before) / 1_048_576;

    // The parent never sees the child's allocation. Generous, because vitest's own
    // bookkeeping moves the parent heap around; the point is orders of magnitude,
    // not megabytes: unbounded, these payloads reach 839-1 650 MB.
    expect(growthMb).toBeLessThan(64);
    expect(await parseInPool(REALISTIC, units)).not.toBeNull();
  });

  /**
   * THE BOUND MUST NOT REFUSE WHAT PARSES TODAY — and this is the assertion that
   * found the one real never-broken RISK in this design. READ THIS BEFORE RETUNING
   * `cookParseTimeoutMs`.
   *
   * These two shapes are LEGITIMATE. `cookParseTimeoutMs` was set at 1 000 ms
   * deliberately ABOVE their measured cost (648 ms / 694 ms) so that nothing which
   * parses today starts failing.
   *
   * MEASURED HERE, AND THE HEADROOM IS THINNER THAN IT LOOKS. On an IDLE box these
   * parse in 331-784 ms and 425-485 ms — comfortably inside the bound. But under
   * heavy CPU contention (the full shared-server run, ~20 vitest workers) the SAME
   * parses were measured at **1 137 ms and 1 238 ms** and were KILLED BY THE BOUND.
   * The bound is wall-clock, and wall clock inflates under contention while the
   * actual work does not. At 1.3-1.4x headroom that is enough to flip.
   *
   * SO THIS TEST ASSERTS WHAT IS ACTUALLY TRUE, AND NOT MORE. It proves the shapes
   * are not INHERENTLY refused — not by the recognizer, not by the heap bound, and
   * not because the parse itself got slower — by running them with the bound raised
   * through its supported env lever. It deliberately does NOT assert that they always
   * fit inside 1 000 ms, because on a contended box they do not, and a test that
   * claimed otherwise would be measuring the machine.
   *
   * THE RESIDUAL RISK IS REAL AND IS THE DIRECTOR'S CALL, recorded in 27-04-SUMMARY:
   * on a loaded LXC 110 (web server + queue workers + Postgres) the worst legitimate
   * `.cook` shapes CAN be refused, costing those recipes their `cook_source`. The
   * answer if that shows up in the field is to RAISE `NORISH_COOK_PARSE_TIMEOUT_MS`
   * deliberately with the number recorded — never to remove the bound, and never to
   * loosen this test.
   */
  it.each(WORST_ACCEPTED.map((entry) => [entry.name, entry] as const))(
    "is not INHERENTLY refused — the worst ACCEPTED shape still parses: %s",
    async (_name, entry) => {
      vi.stubEnv("NORISH_COOK_PARSE_TIMEOUT_MS", "20000");
      vi.resetModules();

      const raised = await import("../../src/cooklang/pool");

      try {
        const startedAt = performance.now();
        const tokens = await raised.parseInPool(entry.source, units);
        const elapsed = performance.now() - startedAt;

        // A legitimate shape must not be refused by the RECOGNIZER or the HEAP
        // bound, and must not have become pathologically slow.
        expect(tokens).not.toBeNull();
        expect(() => CookTokensSchema.parse(tokens)).not.toThrow();
        expect(elapsed).toBeLessThan(5_000);
      } finally {
        raised.shutdownCookParsePool();
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    }
  );
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

    expect(await parseInPool(hostile.source, units)).toBeNull();

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
    const pending = parseInPool(hostile.source, units);

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
      Array.from({ length: concurrency }, () => parseInPool(hostile!.source, units))
    );

    const elapsed = performance.now() - startedAt;

    expect(results).toHaveLength(concurrency);
    expect(results.every((result) => result === null)).toBe(true);

    // Bounded queue + bounded parse. NONE of them may hang.
    expect(elapsed).toBeLessThan(
      COOK_BOUNDS.cookParseTimeoutMs + COOK_BOUNDS.cookParseQueueTimeoutMs + 2_000
    );

    // And the pool still works afterwards.
    expect(await parseInPool(REALISTIC, units)).not.toBeNull();
  });
});

describe("LOGS CARRY COUNTS, CODES AND A PID — NEVER PROSE (T-27-05)", () => {
  it("logs a bound hit with reason/bound/limit/elapsedMs/bytes/pid and no recipe text", async () => {
    // The H1 shape, carrying distinctive prose and an ingredient name so the
    // absence assertions below have something real to look for.
    const source = `---\ntitle: "Grandmother's Secret Cassoulet"\na: ${"[".repeat(
      65_000
    )}\n---\nFold the @duck confit{2%gram} into the beans.\n`;

    expect(await parseInPool(source, units)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    const boundCall = warnSpy.mock.calls.find(
      (call) => (call[0] as { reason?: string })?.reason === "pool-timeout"
    );

    expect(boundCall).toBeDefined();
    expect(boundCall?.[0]).toMatchObject({
      module: "cooklang",
      reason: "pool-timeout",
      bound: "cookParseTimeoutMs",
      limit: COOK_BOUNDS.cookParseTimeoutMs,
    });
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
        parseInPool(hostile!.source, units)
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
describe("`@cooklang/cooklang` is imported by exactly ONE source file", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

  /** Every source file under `packages/` and `apps/`, excluding tests. */
  function sourceFiles(): string[] {
    const found: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
        if (entry === ".cache" || entry === ".next" || entry === "__tests__") continue;

        const full = join(dir, entry);

        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }

        if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) found.push(full);
      }
    };

    walk(join(repoRoot, "packages"));
    walk(join(repoRoot, "apps"));

    return found;
  }

  it("names the importer, so the number cannot drift silently", () => {
    const importers = sourceFiles()
      .filter((file) => /from\s+["']@cooklang\/cooklang["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file))
      .sort();

    // EXACTLY ONE. Not "one plus the old one": `parse.ts` reaches the parser only
    // through the pool now, so a second entry in this list means someone opened a
    // path to the WASM that is outside the bound AND outside the two doors.
    expect(importers).toEqual(["packages/shared-server/src/cooklang/parse-worker.ts"]);
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
