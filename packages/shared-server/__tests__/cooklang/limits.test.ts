// @vitest-environment node
/**
 * T-27-01 — input-size limiting at the two and only two doors to the WASM parser
 * (Phase 27, W3).
 *
 * `@cooklang/cooklang` is a compiled Rust/WASM binary reached, from W3 onward, by
 * text a scraped page / uploaded photo / video transcript steered a language model
 * into producing. It is synchronous and uncancellable, so bounding the INPUT is the
 * only control available.
 *
 * The contract under test:
 *   - every one of the ten `COOK_LIMITS` keys has a breach case AND an at-the-cap
 *     sibling — a limit with no breach test is a limit that does not exist;
 *   - `maxCookSourceBytes` is measured in UTF-8 BYTES, not code units;
 *   - a breach REJECTS (returns `null`), never truncates;
 *   - on a breach the parser is provably NEVER invoked — this file mocks
 *     `@cooklang/cooklang` with a spy that DELEGATES to the real WASM, so the
 *     happy-path control still runs the real parser;
 *   - a hostile corpus sized AT the cap neither throws nor takes longer than 2 s.
 */

import type { StructuredRecipe, StructuredStep } from "@norish/shared/cooklang";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { CookTokensSchema } from "@norish/shared/contracts/zod";

import { structuredToCooklang } from "@norish/shared/cooklang";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";

const units = defaultUnits as UnitsMap;

const parseSpy = vi.fn();

vi.mock("@cooklang/cooklang", async () => {
  const actual = await vi.importActual<typeof import("@cooklang/cooklang")>("@cooklang/cooklang");

  /**
   * Delegates to the REAL parser, so every happy path in this file still exercises
   * the real WASM; the spy exists purely to count invocations.
   */
  class SpyingCooklangParser {
    private readonly inner = new actual.CooklangParser();

    parse(source: string): ReturnType<InstanceType<typeof actual.CooklangParser>["parse"]> {
      parseSpy(source);

      return this.inner.parse(source);
    }
  }

  return { ...actual, CooklangParser: SpyingCooklangParser };
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

const { COOK_LIMITS, checkCookSourceLimits, checkStructuredRecipeLimits, countMalformedCookTokens } =
  await import("../../src/cooklang/limits");
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
  parseSpy.mockClear();
  errorSpy.mockClear();
  warnSpy.mockClear();
});

describe("COOK_LIMITS", () => {
  it("declares exactly the ten T-27-01 caps at their calibrated values", () => {
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
      maxCookMalformedTokens: 8,
    });
    expect(Object.keys(COOK_LIMITS)).toHaveLength(10);
  });
});

describe("checkCookSourceLimits — maxCookSourceBytes", () => {
  it("breaches at 65_537 ASCII bytes", () => {
    const result = checkCookSourceLimits("a".repeat(65_537));

    expect(result).toEqual({
      limit: "maxCookSourceBytes",
      measured: 65_537,
      allowed: 65_536,
    });
  });

  it("passes at exactly 65_536 ASCII bytes — the boundary is asserted on both sides", () => {
    expect(checkCookSourceLimits("a".repeat(65_536))).toBeNull();
  });

  it("REJECTS a multi-byte string whose .length is under the cap but whose UTF-8 byte length is over it", () => {
    // 20 000 astral-plane code points = 40 000 UTF-16 code units (under the cap by
    // `.length`) but 80 000 UTF-8 bytes (over it). The cap is BYTES, not code units.
    const astral = "\u{1F600}".repeat(20_000);

    expect(astral.length).toBeLessThan(COOK_LIMITS.maxCookSourceBytes);
    expect(Buffer.byteLength(astral, "utf8")).toBeGreaterThan(COOK_LIMITS.maxCookSourceBytes);

    const result = checkCookSourceLimits(astral);

    expect(result?.limit).toBe("maxCookSourceBytes");
    expect(result?.measured).toBe(80_000);
  });

  it("does not treat a non-string as a breach (parseCookSource's own type guard owns that)", () => {
    expect(checkCookSourceLimits(null as unknown as string)).toBeNull();
    expect(checkCookSourceLimits(undefined as unknown as string)).toBeNull();
  });
});

describe("countMalformedCookTokens — maxCookMalformedTokens, the cap that bounds parse TIME", () => {
  it("counts ZERO for every shape norish's own serializer emits", () => {
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
      "Bake in the oven ~oven{25%minutes}.",
      "",
    ].join("\n");

    expect(countMalformedCookTokens(source)).toBe(0);
  });

  it("counts ZERO for every committed serializer fixture's real `.cook` output", () => {
    for (const fixture of fixtures) {
      const cook = structuredToCooklang(fixture.recipe, units);

      expect(countMalformedCookTokens(cook)).toBe(0);
      expect(checkCookSourceLimits(cook)).toBeNull();
    }
  });

  it("counts a bare sigil, adjacent sigils and an unterminated brace as malformed", () => {
    expect(countMalformedCookTokens("Rest ~ a while.")).toBe(1);
    expect(countMalformedCookTokens("##")).toBe(2);
    expect(countMalformedCookTokens("@a{1%g")).toBe(1);
    expect(countMalformedCookTokens("@a{1%g\n}")).toBe(1);
    expect(countMalformedCookTokens("~{")).toBe(1);
    // a well-formed sibling of each, to prove the rule is not "any sigil"
    expect(countMalformedCookTokens("Rest ~{1%minute} a while.")).toBe(0);
    expect(countMalformedCookTokens("@a{1%g}")).toBe(0);
    expect(countMalformedCookTokens("@salt")).toBe(0);
    expect(countMalformedCookTokens("#bowl")).toBe(0);
  });

  it("breaches maxCookMalformedTokens at 9 malformed tokens", () => {
    const result = checkCookSourceLimits(`Mix well. ${"~ ".repeat(9)}`);

    expect(result).toEqual({ limit: "maxCookMalformedTokens", measured: 9, allowed: 8 });
  });

  it("passes at exactly 8 malformed tokens — the boundary is asserted on both sides", () => {
    expect(checkCookSourceLimits(`Mix well. ${"~ ".repeat(8)}`)).toBeNull();
  });

  it("REJECTS the pathological families that the BYTE cap alone lets through", () => {
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
    ]) {
      expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(COOK_LIMITS.maxCookSourceBytes);
      expect(checkCookSourceLimits(source)?.limit).toBe("maxCookMalformedTokens");
    }
  });

  it("is total — it never throws on a degenerate string", () => {
    expect(countMalformedCookTokens("")).toBe(0);
    expect(countMalformedCookTokens("@")).toBe(1);
    expect(countMalformedCookTokens("~")).toBe(1);
    expect(() => countMalformedCookTokens(" \uD800@{")).not.toThrow();
  });
});

describe("checkStructuredRecipeLimits — a breach and an at-the-cap sibling for each cap", () => {
  it("breaches maxRecipeNameChars at 501 characters", () => {
    const result = checkStructuredRecipeLimits(recipeWith({ name: "n".repeat(501) }));

    expect(result).toEqual({ limit: "maxRecipeNameChars", measured: 501, allowed: 500 });
  });

  it("passes maxRecipeNameChars at exactly 500 characters", () => {
    expect(checkStructuredRecipeLimits(recipeWith({ name: "n".repeat(500) }))).toBeNull();
  });

  it("breaches maxSteps at 201 steps", () => {
    const result = checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(201) }));

    expect(result).toEqual({ limit: "maxSteps", measured: 201, allowed: 200 });
  });

  it("passes maxSteps at exactly 200 steps", () => {
    expect(checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(200) }))).toBeNull();
  });

  it("breaches maxStepTextChars at 4_001 characters", () => {
    const steps: StructuredStep[] = [{ text: "x".repeat(4_001), order: 1, ingredients: [] }];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxStepTextChars", measured: 4_001, allowed: 4_000 });
  });

  it("passes maxStepTextChars at exactly 4_000 characters", () => {
    const steps: StructuredStep[] = [{ text: "x".repeat(4_000), order: 1, ingredients: [] }];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("breaches maxIngredientRefsPerStep at 61 refs on one step", () => {
    const result = checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(1, 61) }));

    expect(result).toEqual({ limit: "maxIngredientRefsPerStep", measured: 61, allowed: 60 });
  });

  it("passes maxIngredientRefsPerStep at exactly 60 refs on one step", () => {
    expect(checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(1, 60) }))).toBeNull();
  });

  it("breaches maxTotalIngredientRefs at 605 refs spread under the per-step cap", () => {
    // 11 steps x 55 refs: every step is well under `maxIngredientRefsPerStep`, so
    // only the recipe-wide total can catch this.
    const result = checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(11, 55) }));

    expect(result).toEqual({ limit: "maxTotalIngredientRefs", measured: 605, allowed: 600 });
  });

  it("passes maxTotalIngredientRefs at exactly 600 refs", () => {
    expect(checkStructuredRecipeLimits(recipeWith({ steps: stepsOf(10, 60) }))).toBeNull();
  });

  it("breaches maxTimersPerStep at 11 timers on one step", () => {
    const timers = Array.from({ length: 11 }, () => ({ name: null, amount: 1, unit: "minutes" }));
    const steps: StructuredStep[] = [{ text: "Rest.", order: 1, ingredients: [], timers }];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxTimersPerStep", measured: 11, allowed: 10 });
  });

  it("passes maxTimersPerStep at exactly 10 timers on one step", () => {
    const timers = Array.from({ length: 10 }, () => ({ name: null, amount: 1, unit: "minutes" }));
    const steps: StructuredStep[] = [{ text: "Rest.", order: 1, ingredients: [], timers }];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("breaches maxRefNameChars at a 201-character ingredient name", () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "i".repeat(201) }] },
    ];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxRefNameChars", measured: 201, allowed: 200 });
  });

  it("breaches maxRefNameChars at a 201-character TIMER name too", () => {
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

  it("passes maxRefNameChars at exactly 200 characters", () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "i".repeat(200) }] },
    ];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("breaches maxUnitChars at a 41-character unit", () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "flour", amount: 1, unit: "u".repeat(41) }] },
    ];
    const result = checkStructuredRecipeLimits(recipeWith({ steps }));

    expect(result).toEqual({ limit: "maxUnitChars", measured: 41, allowed: 40 });
  });

  it("breaches maxUnitChars at a 41-character TIMER unit too", () => {
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

  it("passes maxUnitChars at exactly 40 characters", () => {
    const steps: StructuredStep[] = [
      { text: "Add it.", order: 1, ingredients: [{ name: "flour", amount: 1, unit: "u".repeat(40) }] },
    ];

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();
  });

  it("passes every committed serializer fixture — if a fixture breached, the CAP would be wrong", () => {
    for (const fixture of fixtures) {
      expect(checkStructuredRecipeLimits(fixture.recipe)).toBeNull();
    }
  });

  it("is total — it never throws on a malformed shape", () => {
    expect(() =>
      checkStructuredRecipeLimits({ name: "x", systemUsed: "metric" } as StructuredRecipe)
    ).not.toThrow();
    expect(checkStructuredRecipeLimits(null as unknown as StructuredRecipe)).toBeNull();
  });
});

describe("THE WASM PARSER IS NEVER INVOKED ON A BREACH (R9)", () => {
  it("control: a real fixture DOES reach the real parser, so the spy is provably wired", () => {
    const payload = buildCookPayload(fixtures[0]!.recipe, units);

    expect(payload).not.toBeNull();
    expect(parseSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("parseCookSource on an oversize source returns null, does not throw, and calls parse 0 times", () => {
    let result: ReturnType<typeof parseCookSource> | undefined;

    expect(() => {
      result = parseCookSource("a".repeat(65_537), units);
    }).not.toThrow();

    expect(result).toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(0);
  });

  it("parseCookSource warns with the limit name and the measured value, and no source text", () => {
    parseCookSource(`@secretIngredient{1%gram} ${"a".repeat(65_537)}`, units);

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

  it("buildCookPayload on a structured breach returns null and calls parse 0 times", () => {
    const oversize = recipeWith({ steps: stepsOf(201, 1) });

    let result: ReturnType<typeof buildCookPayload> | undefined;

    expect(() => {
      result = buildCookPayload(oversize, units);
    }).not.toThrow();

    expect(result).toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("buildCookPayload's breach log carries the limit, the measured value and NO recipe prose (T-27-05)", () => {
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

    expect(buildCookPayload(oversize, units)).toBeNull();
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

  it("buildCookPayload on a serialized-source breach returns null and calls parse 0 times", () => {
    // Within every STRUCTURED cap (100 steps x 3 900 chars) but ~390 KB once
    // serialized — only the pre-parse byte gate can catch this one.
    const steps: StructuredStep[] = Array.from({ length: 100 }, (_unused, index) => ({
      text: "y".repeat(3_900),
      order: index + 1,
      ingredients: [],
    }));

    expect(checkStructuredRecipeLimits(recipeWith({ steps }))).toBeNull();

    const result = buildCookPayload(recipeWith({ steps }), units);

    expect(result).toBeNull();
    expect(parseSpy).toHaveBeenCalledTimes(0);
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

  it("is sized at the cap's baseline value — raise both together, deliberately", () => {
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
   * `refused` records which of the two the cap regime produces, so the test also
   * pins WHICH inputs the malformed-token cap is carrying. Every `refused: true`
   * entry was measured to cost the parser between 4 s and 19 s when allowed through,
   * so those assertions are the ones with teeth (see limits.ts's measurement table).
   */
  const corpus: { name: string; source: string; refused: boolean }[] = [
    { name: "unbalanced opening braces", source: atCap("@a{"), refused: true },
    { name: "unbalanced closing braces", source: atCap("}"), refused: false },
    { name: "nested ingredient tokens", source: atCap("@a{@b{@c{"), refused: true },
    { name: "dense timer sigils", source: atCap("~"), refused: true },
    { name: "dense unit sigils", source: atCap("%"), refused: false },
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
    { name: "deeply repeated legacy metadata lines", source: atCap(">> a: b\n"), refused: false },
    { name: "well-formed cookware at maximum density", source: atCap("#a "), refused: false },
    { name: "well-formed timers at maximum density", source: atCap("~{1%min} "), refused: false },
    { name: "astral-plane characters", source: atCap("\u{1F373}\u{1F9C2}"), refused: false },
    { name: "combining marks", source: atCap("e\u0301\u0302\u0303\u0304"), refused: false },
    { name: "embedded NUL bytes", source: atCap("a\u0000b"), refused: false },
    { name: "lone surrogates", source: atCap("\u{10000}\uD800"), refused: false },
    { name: "mixed sigil soup", source: atCap("@{~}%#|>[]"), refused: true },
  ];

  it("has at least the twelve required adversarial inputs", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(12);
  });

  for (const { name, source, refused } of corpus) {
    it(`neither throws nor exceeds 2000 ms on ${name}`, () => {
      expect(Buffer.byteLength(source, "utf8")).toBeLessThanOrEqual(CORPUS_BYTES);

      parseSpy.mockClear();

      const started = performance.now();
      let result: ReturnType<typeof parseCookSource> | undefined;

      expect(() => {
        result = parseCookSource(source, units);
      }).not.toThrow();

      const elapsed = performance.now() - started;

      expect(elapsed).toBeLessThan(2000);

      if (refused) {
        // Refused at the door: the parser is provably never reached, which is the
        // only reason these inputs cannot cost seconds.
        expect(result).toBeNull();
        expect(parseSpy).toHaveBeenCalledTimes(0);
      } else {
        expect(parseSpy).toHaveBeenCalledTimes(1);
      }

      if (result !== null && result !== undefined) {
        expect(() => CookTokensSchema.parse(result)).not.toThrow();
      }
    });
  }
});
