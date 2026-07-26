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

import {
  COOK_FRONTMATTER_KEYS,
  COOK_FRONTMATTER_MAX_VALUE_CHARS,
  COOK_FRONTMATTER_NUMERIC_KEYS,
  structuredToCooklang,
} from "@norish/shared/cooklang";

import type { CookSourceDefectCode } from "../../src/cooklang/limits";
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
const { parseInPool } = await import("../../src/cooklang/pool");

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
      // QUOTED since W3B (D-27-W3B-06): the frontmatter value grammar is exactly
      // `"…"` or a plain number, so an unquoted `title: Pancakes` is no longer a
      // shape the serializer can emit. `servings` stays a bare number because
      // Cooklang TYPES it as one.
      'title: "Pancakes"',
      "servings: 4",
      'norish.system: "metric"',
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
    expect(findCookSourceDefect('---\ntitle: "X"\n')?.defect).toBe("frontmatter-unterminated");
    expect(findCookSourceDefect("---\nnot a meta line\n---\n\nstep\n")?.defect).toBe(
      "frontmatter-line"
    );
    expect(findCookSourceDefect('---\ntitle: "X"\n---\n\nstep\n')).toBeNull();
    // REWRITTEN IN W3B, AND WORTH SAYING OUT LOUD: this assertion used to read
    // `expect(findCookSourceDefect("---\ntitle: X\n---\n\nstep\n")).toBeNull()`,
    // i.e. it PINNED the acceptance of an unquoted value. That was the H1 hole — the
    // old `FRONTMATTER_LINE` accepted `key: <anything>`, which is how 65 400 raw `[`
    // reached the parser. An unquoted value is now a defect, and the serializer
    // quotes unconditionally so nothing legitimate arrives in that shape.
    expect(findCookSourceDefect("---\ntitle: X\n---\n\nstep\n")?.defect).toBe("frontmatter-value");
  });

  it("REJECTS a section heading the serializer could not have written", async () => {
    expect(findCookSourceDefect("== A = B ==")?.defect).toBe("malformed-heading");
    expect(findCookSourceDefect("== A @ B ==")?.defect).toBe("malformed-heading");
    expect(findCookSourceDefect("== A \\= B ==")).toBeNull();
    expect(findCookSourceDefect("== Dough ==")).toBeNull();
  });
});

/**
 * H1 — THE FRONTMATTER RECOGNIZER WAS UNCONSTRAINED (W3B, D-27-W3B-06).
 *
 * `FRONTMATTER_LINE = /^[A-Za-z][A-Za-z0-9._-]*: .*$/` constrained neither the key
 * set nor the value, so ARBITRARY YAML passed both gates:
 * `---\na: ${"[".repeat(65400)}\n---\nstep\n` — 65 417 bytes, inside every cap,
 * `findCookSourceDefect` returning `null` — parsed for 24 557 ms / 38 511 ms with a
 * 131 218-byte "recursion limit exceeded" report, and the balanced 25 000-/30 000-deep
 * and `{`-nesting variants make it a MONOTONE FAMILY rather than a lucky point.
 *
 * WHAT THIS BLOCK PROVES AND WHAT IT DOES NOT. It proves the recognizer now refuses
 * that family and every neighbouring YAML construct, each with its own named defect
 * code. It does NOT prove the system is bounded — the companion proof, every H1
 * payload driven THROUGH the pool with no recognizer in the way at all, lives in
 * `pool.test.ts` (D-27-W3B-03a). The two are deliberately independent: either alone
 * is sufficient, which is the whole point of the W3B pivot, and this file being the
 * only one that matters is what refuted round 2.
 */
describe("findCookSourceDefect — the CLOSED frontmatter grammar (H1)", () => {
  /** Every measured H1 artefact, verbatim from the verify round. */
  const H1_ARTEFACTS: [string, string][] = [
    ["65 400 unbalanced `[` (65 417 B, 24 557 / 38 511 ms)", `---\na: ${"[".repeat(65_400)}\n---\nstep\n`],
    [
      "balanced 25 000-deep `[`/`]` (4 838 ms)",
      `---\na: ${"[".repeat(25_000)}${"]".repeat(25_000)}\n---\nstep\n`,
    ],
    [
      "balanced 30 000-deep `[`/`]` (8 256 ms)",
      `---\na: ${"[".repeat(30_000)}${"]".repeat(30_000)}\n---\nstep\n`,
    ],
    [
      "`{`-nesting variant (10 489 ms)",
      `---\na: ${"{".repeat(30_000)}${"}".repeat(30_000)}\n---\nstep\n`,
    ],
    ["title: @@@@ ####", "---\ntitle: @@@@ ####\n---\nstep\n"],
    ["YAML anchor + alias `a: &x [*x]`", "---\na: &x [*x]\n---\nstep\n"],
  ];

  for (const [name, source] of H1_ARTEFACTS) {
    it(`returns a NAMED defect for the H1 artefact: ${name}`, async () => {
      // Inside the byte cap — the point of H1 is that no size gate stops it.
      expect(checkCookSourceLimits(source)).toBeNull();

      const defect = findCookSourceDefect(source);

      expect(defect, name).not.toBeNull();
      expect(defect!.defect, name).toMatch(/^frontmatter-/);
      // A POSITION, never a quotation (T-27-05).
      expect(typeof defect!.offset).toBe("number");
    });
  }

  /**
   * One row per YAML construct the old `.*` value pattern accepted, with the exact
   * code each must produce — the codes are the operational signal W5's backfill
   * triages on, so "some defect" is not good enough.
   */
  const REFUSED: [string, string, CookSourceDefectCode][] = [
    ["a literal block scalar", '---\ntitle: |\n  x\n---\nstep\n', "frontmatter-value"],
    ["a folded block scalar", '---\ntitle: >\n  x\n---\nstep\n', "frontmatter-value"],
    ["a flow map", "---\ntitle: {a: b}\n---\nstep\n", "frontmatter-value"],
    ["a flow sequence", "---\ntitle: [a, b]\n---\nstep\n", "frontmatter-value"],
    ["a YAML tag", "---\ntitle: !!str x\n---\nstep\n", "frontmatter-value"],
    ["an unquoted value", "---\ntitle: Pancakes\n---\nstep\n", "frontmatter-value"],
    ["an unquoted numeric title", "---\ntitle: 1.50\n---\nstep\n", "frontmatter-value"],
    ["an empty value", "---\ntitle: \n---\nstep\n", "frontmatter-value"],
    ["an empty QUOTED value", '---\ntitle: ""\n---\nstep\n', "frontmatter-value"],
    ["a whitespace-padded quoted value", '---\ntitle: " a"\n---\nstep\n', "frontmatter-value"],
    ["an unterminated quote", '---\ntitle: "a\n---\nstep\n', "frontmatter-value"],
    ["a quote closed only by an ESCAPED quote", '---\ntitle: "a\\"\n---\nstep\n', "frontmatter-value"],
    ["a RAW quote inside the value", '---\ntitle: "a"b"\n---\nstep\n', "frontmatter-value"],
    ["a RAW backslash inside the value", '---\ntitle: "a\\b"\n---\nstep\n', "frontmatter-value"],
    [
      "a control character inside the value",
      '---\ntitle: "a\u0007b"\n---\nstep\n',
      "frontmatter-value",
    ],
    ["a NUL inside the value", '---\ntitle: "a\u0000b"\n---\nstep\n', "frontmatter-value"],
    ["a QUOTED servings (Cooklang types it as a number)", '---\nservings: "4"\n---\nstep\n', "frontmatter-value"],
    ["an exponential servings", "---\nservings: 1e+21\n---\nstep\n", "frontmatter-value"],
    ["a key not in the closed set", '---\nauthor: "Kiran"\n---\nstep\n', "frontmatter-key"],
    ["a YAML anchor under an unknown key", "---\na: &x [*x]\n---\nstep\n", "frontmatter-key"],
    ["a TAB-indented line", '---\n\ttitle: "x"\n---\nstep\n', "frontmatter-key"],
    ["a SPACE-indented line", '---\n  title: "x"\n---\nstep\n', "frontmatter-key"],
    ["a duplicate key", '---\ntitle: "a"\ntitle: "b"\n---\nstep\n', "frontmatter-duplicate-key"],
    ["a comment line", '---\n# nothing to see\ntitle: "x"\n---\nstep\n', "frontmatter-line"],
    ["a multi-document marker", '---\ntitle: "x"\n...\n---\nstep\n', "frontmatter-line"],
    ["no space after the colon", '---\ntitle:"x"\n---\nstep\n', "frontmatter-line"],
    ["a blank line inside the block", '---\ntitle: "x"\n\n---\nstep\n', "frontmatter-line"],
    ["an unterminated block", '---\ntitle: "x"\n', "frontmatter-unterminated"],
    [
      "more lines than the closed key set has keys",
      `---\n${Array.from({ length: COOK_FRONTMATTER_KEYS.length + 1 }, () => 'title: "x"').join("\n")}\n---\nstep\n`,
      "frontmatter-too-large",
    ],
    [
      "a value longer than the per-key maximum",
      `---\ntitle: "${"a".repeat(COOK_FRONTMATTER_MAX_VALUE_CHARS)}"\n---\nstep\n`,
      "frontmatter-too-large",
    ],
  ];

  for (const [name, source, defect] of REFUSED) {
    it(`REJECTS ${name} with \`${defect}\``, async () => {
      expect(findCookSourceDefect(source)?.defect, name).toBe(defect);
    });
  }

  it("REJECTS a SECOND `---` block, and a `---` block that is not first", async () => {
    // Both land on the BODY recognizer, which is sound about them already: `-` is a
    // metacharacter, and the serializer escapes every `-` it writes into prose, so a
    // bare `---` line outside the leading block cannot be serializer output.
    expect(
      findCookSourceDefect('---\ntitle: "a"\n---\n\nstep\n\n---\ntitle: "b"\n---\n')?.defect
    ).toBe("unescaped-metacharacter");
    expect(findCookSourceDefect('step\n\n---\ntitle: "a"\n---\n')?.defect).toBe(
      "unescaped-metacharacter"
    );
  });

  /**
   * THE TWO-WAY ASSERTION (the plan's Task 3 action). A one-way allowlist rots
   * silently: add a key to the serializer, forget the recognizer, and every recipe
   * that carries the new key loses its `cook_source` — a total outage of the feature
   * that no test would catch. So the key set is asserted in BOTH directions, and it is
   * IMPORTED from the serializer rather than restated here.
   */
  const MAXIMAL: StructuredRecipe = {
    name: "Maximal Metadata",
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 30,
    totalMinutes: 45,
    source: "https://example.test/recipes/maximal",
    systemUsed: "us",
    steps: [{ text: "Mix it.", order: 1, ingredients: [] }],
  };

  /** The frontmatter lines of a `.cook`, without the `---` fences. */
  function frontmatterLinesOf(cook: string): string[] {
    expect(cook.startsWith("---\n")).toBe(true);

    const end = cook.indexOf("\n---\n", 3);

    expect(end).toBeGreaterThan(0);

    return cook.slice(4, end).split("\n");
  }

  it("accepts a REAL serializer-emitted line for every key in the closed set", async () => {
    const lines = frontmatterLinesOf(structuredToCooklang(MAXIMAL, units));

    expect(lines).toHaveLength(COOK_FRONTMATTER_KEYS.length);

    for (const line of lines) {
      // Each line ALONE, so one accepting key cannot mask another being refused.
      expect(findCookSourceDefect(`---\n${line}\n---\n\nstep\n`), line).toBeNull();
    }
  });

  it("the closed key set is EXACTLY what the serializer emits (add a key here and there)", async () => {
    const keys = frontmatterLinesOf(structuredToCooklang(MAXIMAL, units)).map(
      (line) => line.slice(0, line.indexOf(": "))
    );

    expect(keys).toEqual([...COOK_FRONTMATTER_KEYS]);
    expect(new Set(keys).size).toBe(COOK_FRONTMATTER_KEYS.length);
    // and the numeric keys are a SUBSET of the closed set, emitted unquoted
    for (const key of COOK_FRONTMATTER_NUMERIC_KEYS) {
      expect(COOK_FRONTMATTER_KEYS).toContain(key);
      expect(structuredToCooklang(MAXIMAL, units)).toContain(`\n${key}: 4\n`);
    }
  });

  it("the per-value cap is the one the serializer derives its own from", async () => {
    // `@norish/shared` cannot import `COOK_LIMITS` (it must not depend on
    // `@norish/shared-server`), so the constant is duplicated there BY DERIVATION:
    // a quoted `title` is at most twice `maxRecipeNameChars` plus two delimiters.
    expect(COOK_FRONTMATTER_MAX_VALUE_CHARS).toBe(COOK_LIMITS.maxRecipeNameChars * 2 + 2);
  });

  it("agrees with the serializer about every character YAML forbids RAW", async () => {
    // The serializer FOLDS YAML-forbidden characters to a space and keeps TAB; this
    // recognizer mirrors that predicate. Two mirrored predicates drift, so the
    // agreement is asserted over the whole range rather than reviewed.
    const failures: string[] = [];
    const codes = [...Array.from({ length: 0xa0 }, (_unused, code) => code), 0x2028, 0x2029];

    for (const code of codes) {
      const name = `a${String.fromCodePoint(code)}b`;
      const cook = structuredToCooklang(
        { name, systemUsed: "metric", steps: [{ text: "Mix it.", order: 1, ingredients: [] }] },
        units
      );
      const defect = findCookSourceDefect(cook);

      if (defect) failures.push(`U+${code.toString(16).padStart(4, "0")} -> ${defect.defect}`);
    }

    expect(failures).toEqual([]);
  });

  it("accepts a title made entirely of the two characters quoting must escape", async () => {
    // 250 x `"\` is 500 characters of name, which quotes to exactly the cap.
    const name = '"\\'.repeat(250);
    const cook = structuredToCooklang(
      { name, systemUsed: "metric", steps: [{ text: "Mix it.", order: 1, ingredients: [] }] },
      units
    );

    expect(checkStructuredRecipeLimits({ name, systemUsed: "metric", steps: [] })).toBeNull();
    expect(findCookSourceDefect(cook)).toBeNull();
    expect(await parseCookSource(cook, units)).not.toBeNull();
  });
});

/**
 * H2 — A WHITESPACE-ONLY AMOUNT OR UNIT PANICS THE WASM (W3B, D-27-W3B-07).
 *
 * `@a{ %g}` is NINE BYTES, it passed both gates, and it kills the parse with
 * `RuntimeError: unreachable` — a panic in a compiled Rust binary, reached from a
 * prompt-injection surface. `f7bcecb8` closed the EMPTY-amount case (`@a{%g}`,
 * `@a{1%}`) and missed the whitespace-only one, because the recognizer COUNTED
 * characters and a space counts as a character.
 *
 * Confirmed on this tree for all three sigils, and confirmed NOT to poison the
 * parser: after the trap, the same instance parses a good source correctly. So this
 * is not a availability defect on top of the bound — it is the panic class round 2
 * claimed to have closed.
 */
describe("findCookSourceDefect — a whitespace-only amount or unit (H2)", () => {
  const TRAPS = [
    "@a{ %g}\n",
    "~a{ %m}\n",
    "#a{ %g}\n",
    // no trailing newline: the last line has no terminator, which is its own path
    "@a{ %g}",
    "~a{ % }\n",
    "@a{ }\n",
    // TAB and NBSP variants of each sigil
    "@a{\t%g}\n",
    "~a{\t%m}\n",
    "#a{\t%g}\n",
    "@a{\u00a0%g}\n",
    "~a{\u00a0%m}\n",
    "#a{\u00a0%g}\n",
    // padded rather than only-whitespace, and a doubled internal space
    "@a{1 %g}\n",
    "@a{ 1%g}\n",
    "@a{1% g}\n",
    "@a{1%g }\n",
    "@a{1  1/2%g}\n",
    "@a{1%fl  oz}\n",
    // the NAME segment is `escapeTokenText`-shaped too, so it carries no padding
    "@ flour{1%cup}\n",
    "@flour {1%cup}\n",
    "@brown  sugar{1%cup}\n",
    "~ rest{5%minutes}\n",
  ];

  for (const source of TRAPS) {
    it(`REJECTS ${JSON.stringify(source)} and never asks the pool`, async () => {
      expect(findCookSourceDefect(source)?.defect, source).toBe("malformed-token");

      poolSpy.mockClear();

      // The end-to-end consequence, not just the predicate: refused at the door.
      await expect(parseCookSource(source, units)).resolves.toBeNull();
      expect(poolSpy, source).toHaveBeenCalledTimes(0);
    });
  }

  it("still ACCEPTS the whitespace shapes the serializer really emits", async () => {
    // A single INTERNAL space in an amount ("1 1/2") or a unit ("fl oz") survives
    // `escapeTokenText`, so it must stay legal — over-tightening here would refuse
    // real recipes, which is the round-1 failure.
    for (const source of [
      "@a{1 1/2%cup}",
      "@a{1%fl oz}",
      "~a{1 1/2%hours}",
      "@sea salt{}",
      "@flour{2}",
      "@salt",
    ]) {
      expect(findCookSourceDefect(source), source).toBeNull();
    }
  });

  /**
   * BELT AND BRACES: the trap is contained by the CHILD BOUNDARY as well as by the
   * recognizer. `parseInPool` is called DIRECTLY, so nothing here can pass because a
   * recognizer refused the input — the same discipline `pool.test.ts` uses for H1.
   */
  it("the `unreachable` trap is contained by the child process, with the recognizer bypassed", async () => {
    for (const source of ["@a{ %g}\n", "~a{ %m}\n", "#a{ %g}\n"]) {
      await expect(parseInPool(source, units), source).resolves.toBeNull();
    }

    // The parent is alive and the pool still works afterwards.
    expect(await parseInPool("Mix @flour{1%gram}.\n", units)).not.toBeNull();
  });
});

/**
 * NO REGRESSION INTO FALSE REFUSALS — THE 14 REALISTIC RECIPES (the plan's
 * "THE EXACT INPUTS THAT MUST BE RE-TESTED").
 *
 * Round 2 was verified against these fourteen by hand and all fourteen minted; they
 * are COMMITTED here because W3B tightens the recognizer, and a tighter recognizer
 * that starts refusing a real recipe is exactly how round 1 failed. Each one must
 * pass every cap, produce NO defect, and come back from the real parser with a read
 * model.
 */
describe("the 14 realistic recipes still MINT (the false-positive direction)", () => {
  function realistic(
    name: string,
    text: string,
    ingredients: StructuredRecipe["steps"][number]["ingredients"] = [],
    extra: Partial<StructuredRecipe> = {}
  ): StructuredRecipe {
    return {
      name,
      systemUsed: "metric",
      steps: [{ text, order: 1, ingredients }],
      ...extra,
    };
  }

  const REALISTIC: [string, StructuredRecipe][] = [
    ["the pot roast (US shorthand: @ # ~)", POT_ROAST],
    [
      "2% milk",
      realistic("Béchamel", "Warm the 2% milk without boiling it.", [
        { name: "2% milk", amount: 500, unit: "milliliter" },
      ]),
    ],
    [
      "70% dark chocolate",
      realistic("Ganache", "Melt the 70% dark chocolate over a bain-marie.", [
        { name: "70% dark chocolate", amount: 200, unit: "gram" },
      ]),
    ],
    [
      "S&P",
      realistic("Steak", "Season generously with S&P and rest.", [
        { name: "S&P", amount: null, unit: null },
      ]),
    ],
    [
      "Ben & Jerry's",
      realistic("Sundae", "Scoop the Ben & Jerry's into a chilled bowl.", [
        { name: "Ben & Jerry's", amount: 2, unit: "scoop" },
      ]),
    ],
    [
      "3-4 cloves",
      realistic("Aglio e olio", "Slice 3-4 cloves of garlic paper-thin.", [
        { name: "garlic", amount: "3-4", unit: "clove" },
      ]),
    ],
    [
      "1/2 tsp",
      realistic("Cookies", "Add 1/2 tsp of baking soda.", [
        { name: "baking soda", amount: "1/2", unit: "teaspoon" },
      ]),
    ],
    [
      "180°C (350°F)",
      realistic("Sponge", "Bake at 180°C (350°F) for 25 minutes.", [], {
        prepMinutes: 15,
        cookMinutes: 25,
      }),
    ],
    [
      "Dutch: ± 200 g and 2½ uur",
      realistic("Stoofvlees", "Neem ± 200 g boter en stoof 2½ uur zachtjes.", [
        { name: "boter", amount: "± 200", unit: "gram" },
      ]),
    ],
    [
      "CJK",
      realistic("麻婆豆腐", "豆腐を切って、そして炒める。", [
        { name: "豆腐", amount: 400, unit: "gram" },
      ]),
    ],
    [
      "Café @ Home blend",
      realistic("Iced coffee", "Brew the Café @ Home blend twice as strong.", [
        { name: "Café @ Home blend", amount: 30, unit: "gram" },
      ]),
    ],
    [
      "{filtered} water",
      realistic("Sourdough", "Mix the {filtered} water into the flour.", [
        { name: "{filtered} water", amount: 350, unit: "milliliter" },
      ]),
    ],
    [
      "jalapeño #2",
      realistic("Salsa", "Char the jalapeño #2 over an open flame.", [
        { name: "jalapeño #2", amount: 2, unit: "piece" },
      ]),
    ],
    [
      "a numeric title, and `to taste`",
      realistic("1.50", "Finish with olive oil to taste.", [
        { name: "olive oil", amount: null, unit: null },
      ], { servings: 4, source: "https://example.test/1.50" }),
    ],
  ];

  it("is exactly the fourteen recipes the plan enumerates", async () => {
    expect(REALISTIC).toHaveLength(14);
  });

  for (const [name, recipe] of REALISTIC) {
    it(`still mints: ${name}`, async () => {
      const cook = structuredToCooklang(recipe, units);

      expect(checkStructuredRecipeLimits(recipe), name).toBeNull();
      expect(checkCookSourceLimits(cook), name).toBeNull();
      expect(findCookSourceDefect(cook), `${name}: ${JSON.stringify(cook)}`).toBeNull();
      // ...and it earns a read model from the REAL parser, with an empty report.
      expect(await parseCookSource(cook, units), name).not.toBeNull();
    });
  }
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
   * `outcome` NAMES WHICH OF THE THREE, AND IS ASSERTED UNCONDITIONALLY (VERIFY-3
   * blocker 3). It used to be a boolean `refused`, and the accepted half asserted
   * only that `poolSpy` had been CALLED — the structural check on the result sat
   * behind `if (result !== null)`, so a child that failed to spawn (which also
   * resolves `null`, and which was a real, observed failure mode on this tree)
   * passed all ten accepted rows in silence. Probing every accepted row through the
   * real pool also turned up a case the boolean could not express: 8 192 section
   * headings and nothing else is ACCEPTED by the recognizer, crosses the process
   * boundary, parses cleanly, and still resolves `null` — because it describes zero
   * STEPS. That is a correct outcome with its own name, not "sometimes null".
   *
   * Every `refused` entry was measured to cost the parser between 4 s and 35 s (or
   * to TRAP the WASM) when allowed through, so those assertions are the ones with
   * teeth — see the measurement table in `limits.ts`.
   *
   * The families the previous, heuristic gate let through are here explicitly:
   * brace-closed-but-invalid tokens (`@a{1%}`, `~{5}`, `~a{5}`), the verifier's exact
   * 16 x 3 996 bypass, its single-huge-line variant, and the >= 16 KiB `~10 minutes`
   * shape that TRAPS the WASM with `unreachable` rather than merely being slow.
   */
  const corpus: {
    name: string;
    source: string;
    /**
     * `refused` — `findCookSourceDefect` rejected it and THE POOL WAS NEVER ASKED.
     * `tokens` — it crossed the process boundary and came back a schema-valid,
     * NON-EMPTY read model.
     * `no-steps` — it crossed, parsed cleanly and described zero steps, which
     * `parseCookSource` reports as `null` by design (D-27-W2-04).
     */
    outcome: "refused" | "tokens" | "no-steps";
  }[] = [
    { name: "unbalanced opening braces", source: atCap("@a{"), outcome: "refused" },
    { name: "unbalanced closing braces", source: atCap("}"), outcome: "refused" },
    { name: "nested ingredient tokens", source: atCap("@a{@b{@c{"), outcome: "refused" },
    { name: "dense timer sigils", source: atCap("~"), outcome: "refused" },
    { name: "dense unit sigils", source: atCap("%"), outcome: "refused" },
    { name: "dense ingredient sigils", source: atCap("@"), outcome: "refused" },
    { name: "dense cookware sigils", source: atCap("#"), outcome: "refused" },
    {
      name: "malformed timers ahead of one very long line",
      source: `${"~~ ".repeat(2_048)}${"z".repeat(59_392)}`,
      outcome: "refused",
    },
    {
      name: "malformed cookware ahead of one very long line",
      source: `${"## ".repeat(2_048)}${"z".repeat(59_392)}`,
      outcome: "refused",
    },
    {
      name: "one 60 000-byte token with no whitespace",
      source: `@${"z".repeat(60_000)}{1%gram}`,
      outcome: "tokens",
    },
    { name: "deeply repeated section headings", source: atCap("== h ==\n"), outcome: "no-steps" },
    { name: "deeply repeated legacy metadata lines", source: atCap(">> a: b\n"), outcome: "refused" },
    { name: "well-formed cookware at maximum density", source: atCap("#a "), outcome: "tokens" },
    { name: "well-formed timers at maximum density", source: atCap("~{1%min} "), outcome: "tokens" },
    {
      name: "well-formed ingredients at maximum density (the worst ACCEPTED shape)",
      source: atCap("@a{1%g} "),
      outcome: "tokens",
    },
    { name: "astral-plane characters", source: atCap("\u{1F373}\u{1F9C2}"), outcome: "tokens" },
    { name: "combining marks", source: atCap("e\u0301\u0302\u0303\u0304"), outcome: "tokens" },
    { name: "embedded NUL bytes", source: atCap("a\u0000b"), outcome: "tokens" },
    { name: "lone surrogates", source: atCap("\u{10000}\uD800"), outcome: "tokens" },
    { name: "mixed sigil soup", source: atCap("@{~}%#|>[]"), outcome: "refused" },
    // ---- the families the DELETED heuristic scored as well-formed ----
    {
      name: "brace-closed empty unit @a{1%} (the verifier's 16 x 3 996 bypass)",
      source: Array.from({ length: 16 }, () => "@a{1%} ".repeat(571).slice(0, 3_996)).join("\n\n"),
      outcome: "refused",
    },
    {
      name: "brace-closed empty unit @a{1%} on ONE huge line",
      source: "@a{1%} ".repeat(9_362),
      outcome: "refused",
    },
    { name: "brace-closed unit-less timer ~{5}", source: atCap("~{5} "), outcome: "refused" },
    { name: "brace-closed unit-less named timer ~a{5}", source: atCap("~a{5} "), outcome: "refused" },
    {
      name: "the WASM-trap shape `~10 minutes` in a 16 KiB line",
      source: `${"z".repeat(16_384)} ~10 minutes ${"z".repeat(16_384)}`,
      outcome: "refused",
    },
    {
      name: "escaped prose at maximum density (every metacharacter, ACCEPTED)",
      source: atCap("\\@\\#\\~\\{\\}\\%\\=\\>\\-\\\\ "),
      outcome: "tokens",
    },
  ];

  it("has at least the twelve required adversarial inputs", async () => {
    expect(corpus.length).toBeGreaterThanOrEqual(12);
  });

  /** Every reason `./pool` logs when it DEGRADED rather than answered. */
  const POOL_DEGRADED = [
    "pool-cpu",
    "pool-timeout",
    "pool-heap",
    "pool-rss",
    "pool-crash",
    "pool-bad-envelope",
    "pool-saturated",
    "pool-spawn-failed",
  ];

  function loggedReasons(): string[] {
    return [...warnSpy.mock.calls, ...errorSpy.mock.calls].map(
      (call) => (call[0] as { reason?: string })?.reason ?? ""
    );
  }

  for (const { name, source, outcome } of corpus) {
    it(`neither throws nor exceeds 2000 ms on ${name}`, async () => {
      expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(CORPUS_BYTES);

      poolSpy.mockClear();
      warnSpy.mockClear();
      errorSpy.mockClear();

      const started = performance.now();
      // NEVER REJECTS is part of the contract, and `await` is what enforces it: a
      // rejected promise fails this test. The `expect(() => ...).not.toThrow()`
      // wrapper this replaces could not — a rejection is not a throw (R6).
      const result = await parseCookSource(source, units);

      const elapsed = performance.now() - started;

      expect(elapsed).toBeLessThan(2000);

      if (outcome === "refused") {
        // Refused at the door: the parser is provably never reached, which is the
        // only reason these inputs cannot cost seconds.
        expect(result).toBeNull();
        expect(poolSpy).toHaveBeenCalledTimes(0);

        return;
      }

      // ACCEPTED. The pool was asked EXACTLY ONCE, and with the WHOLE source —
      // asserting only "it was called" cannot tell a full parse from a truncated
      // one, and `poolSpy` records the byte length precisely so it can.
      expect(poolSpy).toHaveBeenCalledTimes(1);
      expect(poolSpy).toHaveBeenCalledWith(Buffer.byteLength(source, "utf8"));

      // AND THE POOL ANSWERED — it did not DEGRADE. This is the assertion that was
      // missing (VERIFY-3 blocker 3): a child that cannot spawn, a crashed child, a
      // saturated pool and a bound hit ALL resolve `null`, so without this every one
      // of the accepted rows passed while proving nothing about the parse.
      expect(loggedReasons().filter((reason) => POOL_DEGRADED.includes(reason))).toEqual([]);

      if (outcome === "no-steps") {
        // A source of 8 192 section headings and nothing else: accepted, parsed
        // cleanly, and it describes zero STEPS — so `parseCookSource` reports `null`
        // by design. Named rather than absorbed by an `if (result !== null)`.
        expect(result).toBeNull();

        return;
      }

      // UNCONDITIONAL, so a silent `null` can no longer slip past.
      expect(result).not.toBeNull();
      expect(() => CookTokensSchema.parse(result)).not.toThrow();
      expect((result ?? []).length).toBeGreaterThan(0);
      expect((result ?? [])[0]?.tokens.length).toBeGreaterThan(0);
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
