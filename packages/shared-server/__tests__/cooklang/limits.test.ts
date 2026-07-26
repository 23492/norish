// @vitest-environment node
/**
 * T-27-01 — input-size limiting at the two and only two doors to the WASM parser
 * (Phase 27, W3).
 *
 * `@cooklang/cooklang` is a compiled Rust/WASM binary reached, from W3 onward, by
 * text a scraped page / uploaded photo / video transcript steered a language model
 * into producing.
 *
 * WHAT THIS FILE DOES AND DOES NOT PROVE, SINCE W3B. It covers the INPUT caps and
 * the recognizer — which are now DEFENCE IN DEPTH, not the guarantee. The parse is
 * no longer synchronous-and-uncancellable in this process: it runs in a pooled
 * child process under a wall-clock and a heap bound, and `pool.test.ts` is what
 * proves THAT. A green run here does not mean the system is bounded; it means the
 * cheap first layer still refuses what it should and still accepts what it must.
 *
 * The contract under test:
 *   - every one of the nine `COOK_LIMITS` keys has a breach case AND an at-the-cap
 *     sibling — a limit with no breach test is a limit that does not exist;
 *   - `maxCookSourceBytes` is measured in UTF-8 BYTES, not code units;
 *   - `findCookSourceDefect` accepts exactly what the serializer emits and nothing
 *     else. It replaced a tenth cap (`maxCookMalformedTokens: 8`) that tried to
 *     PREDICT which tokens the parser would object to and was unsound in BOTH
 *     directions — `@a{1%}` closes its brace and scored zero (11 s / 150 MB report
 *     for a 64 KiB source), while `POT_ROAST` scored 12 and was wrongly refused.
 *     Both refutations are pinned here as regression tests;
 *   - a breach REJECTS (returns `null`), never truncates;
 *   - on a breach THE POOL IS PROVABLY NEVER ASKED, so nothing crosses the process
 *     boundary at all. Since W3B that is spied on the POOL, not on the WASM class —
 *     `vi.mock` cannot reach into a child process, and the old spy would have kept
 *     reporting a reassuring `0` forever (D-27-W3B-12). The mock DELEGATES, so the
 *     happy-path control still runs the real parser in a real child;
 *   - a hostile corpus sized AT the cap neither throws nor takes longer than 2 s.
 */

import type { StructuredRecipe, StructuredStep } from "@norish/shared/cooklang";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { CookTokensSchema } from "@norish/shared/contracts/zod";

import { structuredToCooklang } from "@norish/shared/cooklang";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";
import { shutdownCookParsePool } from "../../src/cooklang/pool";

const units = defaultUnits as UnitsMap;

/**
 * THE "PARSER NEVER INVOKED" PROOF, RE-POINTED FROM THE WASM TO THE POOL (W3B,
 * D-27-W3B-12). READ THIS BEFORE CHANGING ANY `poolSpy` ASSERTION BELOW.
 *
 * This file used to prove "0 parse calls on a breach" by `vi.mock`-ing
 * `@cooklang/cooklang` and counting `CooklangParser.parse` calls. Since W3B the
 * parser runs in a CHILD PROCESS, and `vi.mock` cannot reach into one: the mock
 * lives in this module graph and the child has its own. Left alone, every
 * `toHaveBeenCalledTimes(0)` here would have kept passing while proving NOTHING —
 * the exact vacuous-green pattern that hid four real leaks in Phases 22-22.3.
 *
 * So the assertion is re-pointed, and in the process it gets STRONGER: instead of
 * "that one class was not constructed" it is now "THE POOL WAS NEVER ASKED", i.e.
 * nothing crossed the process boundary at all. It is also stable under any future
 * change of isolation mechanism.
 *
 * ANTI-VACUITY IS ASSERTED, NOT ASSUMED: the control test below records the spy
 * count BEFORE and AFTER a real mint and requires it to INCREASE. A spy that is
 * silently unwired fails that test instead of quietly passing every other one.
 *
 * The mock DELEGATES, so every happy path in this file still runs the real WASM in
 * a real child process. `packages/shared-server/__tests__/cooklang/pool.test.ts`
 * carries the companion static assertion that `@cooklang/cooklang` is imported by
 * exactly ONE source file, so this proof cannot be side-stepped by adding a second
 * importer.
 */
const poolSpy = vi.fn();

vi.mock("../../src/cooklang/pool", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/cooklang/pool")>("../../src/cooklang/pool");

  return {
    ...actual,
    parseInPool: (...args: Parameters<typeof actual.parseInPool>) => {
      poolSpy(Buffer.byteLength(args[0] ?? "", "utf8"));

      return actual.parseInPool(...args);
    },
  };
});

const errorSpy = vi.fn();
const warnSpy = vi.fn();

vi.mock("../../src/logger", () => ({
  parserLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: (...args: unknown[]) => errorSpy(...args),
  },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const {
  COOK_LIMITS,
  checkCookSourceLimits,
  checkStructuredRecipeLimits,
  findCookSourceDefect,
} = await import("../../src/cooklang/limits");
const { parseCookSource } = await import("../../src/cooklang/parse");
const { buildCookPayload } = await import("../../src/cooklang/build-payload");

/** A minimal, always-valid structured recipe to mutate one field of at a time. */
function recipeWith(overrides: Partial<StructuredRecipe>): StructuredRecipe {
  return {
    name: "Baseline",
    systemUsed: "metric",
    steps: [{ text: "Mix the flour with water.", order: 1, ingredients: [] }],
    ...overrides,
  };
}

/**
 * THE FALSE-POSITIVE REGRESSION FIXTURE. Ordinary US shorthand — `@` for "at",
 * `#` for "pound", `~` for "about" — in a plain 9-step recipe. The deleted
 * `maxCookMalformedTokens: 8` scored it 12 and REFUSED it, although the real parser
 * handles it in 13 ms with an EMPTY report. It must earn a `cook_source`.
 */
const POT_ROAST: StructuredRecipe = {
  name: "Grandma's Pot Roast",
  systemUsed: "us",
  steps: [
    "Preheat the oven @ 325 degrees.",
    "Season a 3 # chuck roast all over.",
    "Sear it in a heavy pot ~ 4 minutes per side.",
    "Add 1 # of carrots and 2 onions, quartered.",
    "Pour in stock until it comes ~ halfway up the meat.",
    "Cover and braise @ 325 for 3 - 3 1/2 hours.",
    "Skim the fat, then reduce ~ 10 minutes.",
    "Whisk in a slurry (1 tbsp flour + 2 tbsp water) at ~ 50% heat.",
    "Rest 15 minutes, slice against the grain, serve @ the table.",
  ].map((text, order) => ({ text, order, ingredients: [] })),
};

function stepsOf(count: number, ingredientsPerStep = 0): StructuredStep[] {
  return Array.from({ length: count }, (_, index) => ({
    text: `Step ${index + 1}.`,
    order: index + 1,
    ingredients: Array.from({ length: ingredientsPerStep }, (_unused, ref) => ({
      name: `ingredient ${ref}`,
      amount: 1,
      unit: "gram",
    })),
  }));
}

beforeEach(() => {
  poolSpy.mockClear();
  errorSpy.mockClear();
  warnSpy.mockClear();
});

describe("COOK_LIMITS", () => {
  it("declares exactly the nine T-27-01 caps at their calibrated values", async () => {
    expect(COOK_LIMITS).toEqual({
      maxCookSourceBytes: 65_536,
      maxSteps: 200,
      maxStepTextChars: 4_000,
      maxIngredientRefsPerStep: 60,
      maxTotalIngredientRefs: 600,
      maxTimersPerStep: 10,
      maxRefNameChars: 200,
      maxUnitChars: 40,
      maxRecipeNameChars: 500,
    });
    expect(Object.keys(COOK_LIMITS)).toHaveLength(9);
  });
});

describe("checkCookSourceLimits — maxCookSourceBytes", () => {
  it("breaches at 65_537 ASCII bytes", async () => {
    const result = checkCookSourceLimits("a".repeat(65_537));

    expect(result).toEqual({
      limit: "maxCookSourceBytes",
      measured: 65_537,
      allowed: 65_536,
    });
  });

  it("passes at exactly 65_536 ASCII bytes — the boundary is asserted on both sides", async () => {
    expect(checkCookSourceLimits("a".repeat(65_536))).toBeNull();
  });

  it("REJECTS a multi-byte string whose .length is under the cap but whose UTF-8 byte length is over it", async () => {
    // 20 000 astral-plane code points = 40 000 UTF-16 code units (under the cap by
    // `.length`) but 80 000 UTF-8 bytes (over it). The cap is BYTES, not code units.
    const astral = "\u{1F600}".repeat(20_000);

    expect(astral.length).toBeLessThan(COOK_LIMITS.maxCookSourceBytes);
    expect(Buffer.byteLength(astral, "utf8")).toBeGreaterThan(COOK_LIMITS.maxCookSourceBytes);

    const result = checkCookSourceLimits(astral);

    expect(result?.limit).toBe("maxCookSourceBytes");
    expect(result?.measured).toBe(80_000);
  });

  it("does not treat a non-string as a breach (parseCookSource's own type guard owns that)", async () => {
    expect(checkCookSourceLimits(null as unknown as string)).toBeNull();
    expect(checkCookSourceLimits(undefined as unknown as string)).toBeNull();
  });
});

describe("findCookSourceDefect — the gate that bounds parse TIME", () => {
  it("accepts every shape norish's own serializer emits", async () => {
    const source = [
      "---",
      "title: Pancakes",
      "servings: 4",
      "norish.system: metric",
      "---",
      "Mix the @flour{200%gram} with @milk{300%milliliter}.",
      "",
      "== Filling ==",
      "",
      "Add @salt and @sea salt{} then rest ~{10%minutes}.",
      "",
      "Bake in the #oven{} for ~oven{25%minutes}.",
      "",
      "Preheat the oven \\@ 325, a 3 \\# roast, reduce \\~ 10 minutes.",
      "",
    ].join("\n");

    expect(findCookSourceDefect(source)).toBeNull();
  });

  it("accepts every committed serializer fixture's real `.cook` output", async () => {
    for (const fixture of fixtures) {
      const cook = structuredToCooklang(fixture.recipe, units);

      expect(findCookSourceDefect(cook), fixture.slug).toBeNull();
      expect(checkCookSourceLimits(cook)).toBeNull();
    }
  });

  it("REJECTS the bypass family the malformed-token COUNT scored as well-formed", async () => {
    // Every one of these closes its brace, so the deleted `countMalformedCookTokens`
    // scored them ZERO malformed and let a 64 KiB source of them reach the parser
    // (measured: 11 118 ms, a 150 MB diagnostic report). They are refused now
    // because none of them is a shape the serializer can emit.
    for (const source of ["@a{1%}", "~{5}", "~a{5}", "@{2%g}", "#{2}", "@a{%g}", "@a{1%%g}"]) {
      expect(findCookSourceDefect(source)?.defect, source).toBe("malformed-token");
    }
  });

  it("REJECTS a bare sigil, adjacent sigils, an unterminated brace and the WASM-trap shape", async () => {
    for (const source of [
      "Rest ~ a while.",
      "##",
      "@a{1%g",
      "@a{1%g\n}",
      "~{",
      "a ~10 minutes b",
    ]) {
      expect(findCookSourceDefect(source), source).not.toBeNull();
    }

    // a well-formed sibling of each, to prove the rule is not "any sigil"
    expect(findCookSourceDefect("Rest ~{1%minute} a while.")).toBeNull();
    expect(findCookSourceDefect("Rest \\~ a while.")).toBeNull();
    expect(findCookSourceDefect("@a{1%g}")).toBeNull();
    expect(findCookSourceDefect("@salt")).toBeNull();
    expect(findCookSourceDefect("#bowl")).toBeNull();
    expect(findCookSourceDefect("@sea salt{}")).toBeNull();
  });

  it("REJECTS an unescaped metacharacter in prose and ACCEPTS the escaped form", async () => {
    for (const meta of ["\\", "@", "#", "~", "{", "}", "%", "=", ">", "-"]) {
      expect(findCookSourceDefect(`Mix a ${meta} b`), `bare ${meta}`).not.toBeNull();
      expect(findCookSourceDefect(`Mix a \\${meta} b`), `escaped ${meta}`).toBeNull();
    }
  });

  it("REJECTS the pathological families that the BYTE cap alone lets through", async () => {
    // Each of these is at or under `maxCookSourceBytes` yet costs the parser
    // seconds-to-minutes; the byte cap is not what stops them.
    for (const source of [
      "#".repeat(2_048),
      "~".repeat(2_048),
      "@".repeat(65_536),
      `${"## ".repeat(2_048)}${"z".repeat(59_392)}`,
      `${"~~ ".repeat(2_048)}${"z".repeat(59_392)}`,
      "@a{".repeat(21_845),
      "@{~}%#|>[]".repeat(6_553),
      // THE VERIFIER'S EXACT BYPASS: 16 step texts of 3 996 chars, each under
      // `maxStepTextChars`, of `@a{1%} `. 63 966 bytes, under the byte cap, ZERO
      // malformed by the deleted counter, 11 118 ms and a 150 MB report if parsed.
      Array.from({ length: 16 }, () => "@a{1%} ".repeat(571).slice(0, 3_996)).join("\n\n"),
      // the single-huge-line variant of the same
      "@a{1%} ".repeat(9_362),
    ]) {
      expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(COOK_LIMITS.maxCookSourceBytes);
      expect(checkCookSourceLimits(source)).toBeNull();
      expect(findCookSourceDefect(source)).not.toBeNull();
    }
  });

  it("does NOT refuse ordinary US shorthand once the serializer has escaped it", async () => {
    // The 536-byte recipe the verifier used to refute "near-zero false positives":
    // the deleted counter scored it 12 malformed and REFUSED it, although the real
    // parser handles it in 13 ms with an empty report.
    const cook = structuredToCooklang(POT_ROAST, units);

    expect(checkStructuredRecipeLimits(POT_ROAST)).toBeNull();
    expect(checkCookSourceLimits(cook)).toBeNull();
    expect(findCookSourceDefect(cook)).toBeNull();
    // and it earns a read model: it reaches the parser and parses cleanly
    expect(await parseCookSource(cook, units)).not.toBeNull();
  });

  it("is total — it never throws on a degenerate string", async () => {
    expect(findCookSourceDefect("")).toBeNull();
    expect(findCookSourceDefect("@")?.defect).toBe("malformed-token");
    expect(findCookSourceDefect("~")?.defect).toBe("malformed-token");
    expect(findCookSourceDefect("\\")?.defect).toBe("invalid-escape");
    // only a METACHARACTER is ever escaped, so `\\ ` is not serializer output
    expect(findCookSourceDefect("Mix a \\ b")?.defect).toBe("invalid-escape");
    expect(() => findCookSourceDefect(" \uD800@{")).not.toThrow();
    expect(findCookSourceDefect(null as unknown as string)).toBeNull();
  });

  it("REJECTS a frontmatter block the serializer could not have written", async () => {
    expect(findCookSourceDefect("---\ntitle: X\n")?.defect).toBe("frontmatter-unterminated");
    expect(findCookSourceDefect("---\nnot a meta line\n---\n\nstep\n")?.defect).toBe(
      "frontmatter-line"
    );
    expect(findCookSourceDefect("---\ntitle: X\n---\n\nstep\n")).toBeNull();
  });

  it("REJECTS a section heading the serializer could not have written", async () => {
    expect(findCookSourceDefect("== A = B ==")?.defect).toBe("malformed-heading");
    expect(findCookSourceDefect("== A @ B ==")?.defect).toBe("malformed-heading");
    expect(findCookSourceDefect("== A \\= B ==")).toBeNull();
    expect(findCookSourceDefect("== Dough ==")).toBeNull();
  });
});

describe("checkStructuredRecipeLimits — a breach and an at-the-cap sibling for each cap", () => {
  it("breaches maxRecipeNameChars at 501 characters", async () => {
    const result = checkStructuredRecipeLimits(recipeWith({ name: "n".repeat(501) }));

    expect(result).toEqual({ limit: "maxRecipeNameChars", measured: 501, allowed: 500 });
  });

  it("passes maxRecipeNameChars at exactly 500 characters", async () => {
    expect(checkStructuredRecipeLimits(recipeWith({ name: "n".repeat(500) }))).toBeNull();
  });

  it("breaches maxSteps at 201 steps", async () => {
    const result = checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(201) }));

    expect(result).toEqual({ limit: "maxSteps", measured: 201, allowed: 200 });
  });

  it("passes maxSteps at exactly 200 steps", async () => {
    expect(checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(200) }))).toBeNull();
  });

  it("breaches maxStepTextChars at 4_001 characters", async () => {
    const steps: StructuredStep[] = [{ text: "x".repeat(4_001), order: 1, ingredients: [] }];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxStepTextChars", measured: 4_001, allowed: 4_000 });
  });

  it("passes maxStepTextChars at exactly 4_000 characters", async () => {
    const steps: StructuredStep[] = [{ text: "x".repeat(4_000), order: 1, ingredients: [] }];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("breaches maxIngredientRefsPerStep at 61 refs on one step", async () => {
    const result = checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(1, 61) }));

    expect(result).toEqual({ limit: "maxIngredientRefsPerStep", measured: 61, allowed: 60 });
  });

  it("passes maxIngredientRefsPerStep at exactly 60 refs on one step", async () => {
    expect(checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(1, 60) }))).toBeNull();
  });

  it("breaches maxTotalIngredientRefs at 605 refs spread under the per-step cap", async () => {
    // 11 steps x 55 refs: every step is well under `maxIngredientRefsPerStep`, so
    // only the recipe-wide total can catch this.
    const result = checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(11, 55) }));

    expect(result).toEqual({ limit: "maxTotalIngredientRefs", measured: 605, allowed: 600 });
  });

  it("passes maxTotalIngredientRefs at exactly 600 refs", async () => {
    expect(checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(10, 60) }))).toBeNull();
  });

  it("breaches maxTimersPerStep at 11 timers on one step", async () => {
    const timers = Array.from({ length: 11 }, () => ({ name: null, amount: 1, unit: "minutes" }));
    const steps: StructuredStep[] = [{ text: "Rest.", order: 1, ingredients: [], timers }];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxTimersPerStep", measured: 11, allowed: 10 });
  });

  it("passes maxTimersPerStep at exactly 10 timers on one step", async () => {
    const timers = Array.from({ length: 10 }, () => ({ name: null, amount: 1, unit: "minutes" }));
    const steps: StructuredStep[] = [{ text: "Rest.", order: 1, ingredients: [], timers }];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("breaches maxRefNameChars at a 201-character ingredient name", async () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "i".repeat(201) }] },
    ];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxRefNameChars", measured: 201, allowed: 200 });
  });

  it("breaches maxRefNameChars at a 201-character TIMER name too", async () => {
    const steps: StructuredStep[] = [
      {
        text: "Rest.",
        order: 1,
        ingredients: [],
        timers: [{ name: "t".repeat(201), amount: 1, unit: "minutes" }],
      },
    ];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxRefNameChars", measured: 201, allowed: 200 });
  });

  it("passes maxRefNameChars at exactly 200 characters", async () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "i".repeat(200) }] },
    ];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("breaches maxUnitChars at a 41-character unit", async () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "flour", amount: 1, unit: "u".repeat(41) }] },
    ];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxUnitChars", measured: 41, allowed: 40 });
  });

  it("breaches maxUnitChars at a 41-character TIMER unit too", async () => {
    const steps: StructuredStep[] = [
      {
        text: "Rest.",
        order: 1,
        ingredients: [],
        timers: [{ name: null, amount: 1, unit: "u".repeat(41) }],
      },
    ];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxUnitChars", measured: 41, allowed: 40 });
  });

  it("passes maxUnitChars at exactly 40 characters", async () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "flour", amount: 1, unit: "u".repeat(40) }] },
    ];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("passes every committed serializer fixture — if a fixture breached, the CAP would be wrong", async () => {
    for (const fixture of fixtures) {
      expect(checkStructuredRecipeLimits(fixture.recipe)).toBeNull();
    }
  });

  it("is total — it never throws on a malformed shape", async () => {
    expect(() =>
      checkStructuredRecipeLimits({ name: "x", systemUsed: "metric" } as StructuredRecipe)
    ).not.toThrow();
    expect(checkStructuredRecipeLimits(null as unknown as StructuredRecipe)).toBeNull();
  });
});

describe("THE PARSER IS NEVER ASKED ON A BREACH (R9, re-pointed to the pool in W3B)", () => {
  /**
   * THE ANTI-VACUITY CONTROL. Every other assertion in this describe block is a
   * `toHaveBeenCalledTimes(0)`, and a `0` is exactly what an UNWIRED spy reports.
   * So the wiring itself is asserted, with an explicit BEFORE and AFTER count that
   * must INCREASE across a real mint. If the pool mock ever stops intercepting —
   * a moved module path, a renamed export, a change of isolation mechanism — this
   * test fails, instead of the whole block passing while proving nothing.
   */
  it("control: the pool spy is provably WIRED — count goes 0 -> 1 across a real mint", async () => {
    const before = poolSpy.mock.calls.length;

    expect(before).toBe(0);

    const payload = await buildCookPayload(fixtures[0]!.recipe, units);

    const after = poolSpy.mock.calls.length;

    // A real mint really did cross the process boundary, and really did come back.
    expect(payload).not.toBeNull();
    expect(after).toBeGreaterThan(before);
    expect(after).toBe(1);
    // ...and the spy records BYTE COUNTS, never the source itself (T-27-05).
    expect(poolSpy.mock.calls[0]?.[0]).toBe(
      Buffer.byteLength(payload!.cookSource, "utf8")
    );
  });

  it("parseCookSource on an oversize source returns null, does not throw, and calls parse 0 times", async () => {
    // A rejected promise is not a throw, so the `expect(() => ...).not.toThrow()`
    // wrapper this replaces was VACUOUS against an async `parseCookSource` (R6).
    // `resolves` asserts BOTH halves: it did not reject, AND the value is null.
    await expect(parseCookSource("a".repeat(65_537), units)).resolves.toBeNull();
    expect(poolSpy).toHaveBeenCalledTimes(0);
  });

  it("parseCookSource warns with the limit name and the measured value, and no source text", async () => {
    await parseCookSource(`@secretIngredient{1%gram} ${"a".repeat(65_537)}`, units);

    expect(warnSpy).toHaveBeenCalled();

    const [payload] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];

    expect(payload).toMatchObject({
      reason: "input-too-large",
      limit: "maxCookSourceBytes",
      allowed: 65_536,
    });
    expect(payload.measured).toBeGreaterThan(65_536);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secretIngredient");
  });

  it("buildCookPayload on a structured breach returns null and calls parse 0 times", async () => {
    const oversize = recipeWith({ steps: stepsOf(201, 1) });

    // `resolves` rather than `not.toThrow()`: see the note above (R6).
    await expect(buildCookPayload(oversize, units)).resolves.toBeNull();
    expect(poolSpy).toHaveBeenCalledTimes(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("buildCookPayload's breach log carries the limit, the measured value and NO recipe prose (T-27-05)", async () => {
    const oversize = recipeWith({
      name: "Grandmother's Secret Cassoulet",
      steps: [
        {
          text: "Fold the confit into the beans without breaking them.",
          order: 1,
          ingredients: [{ name: "duck confit", amount: 2, unit: "u".repeat(41) }],
        },
      ],
    });

    expect(await buildCookPayload(oversize, units)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const [payload] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];

    expect(payload).toMatchObject({
      module: "cooklang",
      reason: "input-too-large",
      limit: "maxUnitChars",
      measured: 41,
      allowed: 40,
      stepCount: 1,
      ingredientCount: 1,
    });

    // Counts and limit names only — an ingredient name is per-cookbook data.
    const serialized = JSON.stringify(errorSpy.mock.calls);

    expect(serialized).not.toContain("Grandmother");
    expect(serialized).not.toContain("Cassoulet");
    expect(serialized).not.toContain("confit");
    expect(serialized).not.toContain("Fold the");
  });

  it("buildCookPayload on a serialized-source breach returns null and calls parse 0 times", async () => {
    // Within every STRUCTURED cap (100 steps x 3 900 chars) but ~390 KB once
    // serialized — only the pre-parse byte gate can catch this one.
    const steps: StructuredStep[] = Array.from({ length: 100 }, (_unused, index) => ({
      text: "y".repeat(3_900),
      order: index + 1,
      ingredients: [],
    }));

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();

    const result = await buildCookPayload(recipeWith({ steps }), units);

    expect(result).toBeNull();
    expect(poolSpy).toHaveBeenCalledTimes(0);
  });
});

describe("the hostile corpus — adversarial input sized AT the cap", () => {
  /**
   * The corpus is sized against a LITERAL 65 536, not against
   * `COOK_LIMITS.maxCookSourceBytes`. That is deliberate and load-bearing: this
   * suite's job is to police the cap, so it must not derive its inputs from the
   * value it is policing. Sized from the constant, raising the cap to
   * `Number.MAX_SAFE_INTEGER` makes `chunk.repeat` throw `RangeError: Invalid
   * string length` and the file fails to COLLECT — which looks red but proves
   * nothing about the boundary. Sized from a literal, the same weakening lets the
   * corpus build and turns the parser-never-invoked and elapsed-time assertions
   * red instead, which is the property under test.
   */
  const CORPUS_BYTES = 65_536;

  it("is sized at the cap's baseline value — raise both together, deliberately", async () => {
    expect(COOK_LIMITS.maxCookSourceBytes).toBe(CORPUS_BYTES);
  });

  /** Repeat `chunk` until it fills the cap without exceeding it. */
  function atCap(chunk: string): string {
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    const times = Math.floor(CORPUS_BYTES / chunkBytes);

    return chunk.repeat(Math.max(times, 1));
  }

  /**
   * Every input is sized AT `maxCookSourceBytes`. `parseCookSource` must, for each,
   * return `null` or a `CookTokensSchema`-valid DTO, never throw, and finish inside
   * 2 000 ms — whether it gets there by REFUSING the source or by parsing it.
   *
   * `refused` records which of the two the gate regime produces, so the test also
   * pins WHICH inputs `findCookSourceDefect` is carrying. Every `refused: true`
   * entry was measured to cost the parser between 4 s and 35 s (or to TRAP the WASM)
   * when allowed through, so those assertions are the ones with teeth — see the
   * measurement table in `limits.ts`.
   *
   * The families the previous, heuristic gate let through are here explicitly:
   * brace-closed-but-invalid tokens (`@a{1%}`, `~{5}`, `~a{5}`), the verifier's exact
   * 16 x 3 996 bypass, its single-huge-line variant, and the >= 16 KiB `~10 minutes`
   * shape that TRAPS the WASM with `unreachable` rather than merely being slow.
   */
  const corpus: { name: string; source: string; refused: boolean }[] = [
    { name: "unbalanced opening braces", source: atCap("@a{"), refused: true },
    { name: "unbalanced closing braces", source: atCap("}"), refused: true },
    { name: "nested ingredient tokens", source: atCap("@a{@b{@c{"), refused: true },
    { name: "dense timer sigils", source: atCap("~"), refused: true },
    { name: "dense unit sigils", source: atCap("%"), refused: true },
    { name: "dense ingredient sigils", source: atCap("@"), refused: true },
    { name: "dense cookware sigils", source: atCap("#"), refused: true },
    {
      name: "malformed timers ahead of one very long line",
      source: `${"~~ ".repeat(2_048)}${"z".repeat(59_392)}`,
      refused: true,
    },
    {
      name: "malformed cookware ahead of one very long line",
      source: `${"## ".repeat(2_048)}${"z".repeat(59_392)}`,
      refused: true,
    },
    {
      name: "one 60 000-byte token with no whitespace",
      source: `@${"z".repeat(60_000)}{1%gram}`,
      refused: false,
    },
    { name: "deeply repeated section headings", source: atCap("== h ==\n"), refused: false },
    { name: "deeply repeated legacy metadata lines", source: atCap(">> a: b\n"), refused: true },
    { name: "well-formed cookware at maximum density", source: atCap("#a "), refused: false },
    { name: "well-formed timers at maximum density", source: atCap("~{1%min} "), refused: false },
    {
      name: "well-formed ingredients at maximum density (the worst ACCEPTED shape)",
      source: atCap("@a{1%g} "),
      refused: false,
    },
    { name: "astral-plane characters", source: atCap("\u{1F373}\u{1F9C2}"), refused: false },
    { name: "combining marks", source: atCap("e\u0301\u0302\u0303\u0304"), refused: false },
    { name: "embedded NUL bytes", source: atCap("a\u0000b"), refused: false },
    { name: "lone surrogates", source: atCap("\u{10000}\uD800"), refused: false },
    { name: "mixed sigil soup", source: atCap("@{~}%#|>[]"), refused: true },
    // ---- the families the DELETED heuristic scored as well-formed ----
    {
      name: "brace-closed empty unit @a{1%} (the verifier's 16 x 3 996 bypass)",
      source: Array.from({ length: 16 }, () => "@a{1%} ".repeat(571).slice(0, 3_996)).join("\n\n"),
      refused: true,
    },
    {
      name: "brace-closed empty unit @a{1%} on ONE huge line",
      source: "@a{1%} ".repeat(9_362),
      refused: true,
    },
    { name: "brace-closed unit-less timer ~{5}", source: atCap("~{5} "), refused: true },
    { name: "brace-closed unit-less named timer ~a{5}", source: atCap("~a{5} "), refused: true },
    {
      name: "the WASM-trap shape `~10 minutes` in a 16 KiB line",
      source: `${"z".repeat(16_384)} ~10 minutes ${"z".repeat(16_384)}`,
      refused: true,
    },
    {
      name: "escaped prose at maximum density (every metacharacter, ACCEPTED)",
      source: atCap("\\@\\#\\~\\{\\}\\%\\=\\>\\-\\\\ "),
      refused: false,
    },
  ];

  it("has at least the twelve required adversarial inputs", async () => {
    expect(corpus.length).toBeGreaterThanOrEqual(12);
  });

  for (const { name, source, refused } of corpus) {
    it(`neither throws nor exceeds 2000 ms on ${name}`, async () => {
      expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(CORPUS_BYTES);

      poolSpy.mockClear();

      const started = performance.now();
      // NEVER REJECTS is part of the contract, and `await` is what enforces it: a
      // rejected promise fails this test. The `expect(() => ...).not.toThrow()`
      // wrapper this replaces could not — a rejection is not a throw (R6).
      const result = await parseCookSource(source, units);

      const elapsed = performance.now() - started;

      expect(elapsed).toBeLessThan(2000);

      if (refused) {
        // Refused at the door: the parser is provably never reached, which is the
        // only reason these inputs cannot cost seconds.
        expect(result).toBeNull();
        expect(poolSpy).toHaveBeenCalledTimes(0);
      } else {
        expect(poolSpy).toHaveBeenCalledTimes(1);
      }

      if (result !== null && result !== undefined) {
        expect(() => CookTokensSchema.parse(result)).not.toThrow();
      }
    });
  }
});

/**
 * R4: vitest will not exit while a child process lives, so every suite that parses
 * must tear the pool down. A leaked child hangs the whole run.
 */
afterAll(() => {
  shutdownCookParsePool();
});
