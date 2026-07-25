// @vitest-environment node
/**
 * `buildCookFromExtraction` — W3's minting call site (COOK-01 / Phase 27 W3).
 *
 * THE CONTRACT UNDER TEST IS A REFUSAL CONTRACT. This function turns an AI
 * extraction into a `.cook`, and every way it can decline to do so must cost the
 * user NOTHING: `null` means the caller passes no `cook` argument, the legacy
 * projection is written in full, and the import succeeds. Failing a gate is the
 * ORDINARY case, not an error.
 *
 * The four refusals:
 *   1. no per-step linkage at all (a string-shaped extraction) — DEBUG, not error;
 *   2. THE COVERAGE GATE (D-27-W3-04) — a flat ingredient no step references;
 *   3. a size-cap breach (T-27-01), decided inside `buildCookPayload`;
 *   4. output that does not parse with an empty report (D-27-W2-04), likewise.
 *
 * Runs against the REAL serializer, the REAL WASM parser and the REAL caps —
 * mocking any of them would test nothing. The last two refusals mock only the
 * narrow seam they need.
 *
 * It also carries the D-27-W3-07 MEASUREMENT: for each of the five committed
 * fixtures, the AI-emitted US ingredient list against the list the projection
 * derives from the metric `.cook`. Same names and same count is a HARD assertion
 * (an ingredient may never be lost); unit differences are accepted and REPORTED,
 * because that report is the evidence for whether W0's unit-vocabulary work must
 * land before W5.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeExtractionOutput } from "@norish/api/ai/schemas/recipe.schema";
import type { UnitsMap } from "@norish/config/zod/server-config";
import type { FullRecipeInsertDTO } from "@norish/shared/contracts/dto/recipe";
import defaultUnits from "@norish/config/units.default.json";
import { computeCookProjection } from "@norish/db/repositories/cook-projection";
import { CookTokensSchema } from "@norish/shared/contracts/zod";
import { parseIngredientWithDefaults } from "@norish/shared/lib/helpers";

import { fixtures } from "../../../../../shared/__tests__/cooklang/fixtures";

const units = defaultUnits as UnitsMap;

/** Flipped by the "does not parse cleanly" case only. */
let forceParseNull = false;

vi.mock("@norish/shared-server/cooklang/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/cooklang/parse")>();

  return {
    ...actual,
    parseCookSource: (source: string, unitsMap?: UnitsMap) =>
      forceParseNull ? null : actual.parseCookSource(source, unitsMap),
  };
});

const logSpy = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  // The module graph pulled in here calls `parserLogger.child(...)` at import time.
  child: () => logSpy,
};

vi.mock("@norish/shared-server/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/logger")>();

  return { ...actual, aiLogger: logSpy, parserLogger: logSpy };
});

const { buildCookFromExtraction } =
  await import("@norish/api/ai/features/recipe-extraction/normalizer");

// --------------------------------------------------------------------------
// fixture builders
// --------------------------------------------------------------------------

type StepInput =
  | string
  | {
      text: string;
      ingredients?: { name: string; amount: number | string | null; unit: string | null }[];
      timers?: { name: string | null; amount: number | string; unit: string }[];
    };

function makeOutput(overrides: {
  name?: string;
  metricFlat: string[];
  usFlat?: string[];
  metricSteps: StepInput[];
  usSteps?: StepInput[];
}): RecipeExtractionOutput {
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: overrides.name ?? "Test Recipe",
    description: null,
    notes: null,
    recipeYield: 4,
    prepTime: null,
    cookTime: null,
    totalTime: null,
    recipeIngredient: {
      metric: overrides.metricFlat,
      us: overrides.usFlat ?? overrides.metricFlat,
    },
    recipeInstructions: {
      metric: overrides.metricSteps,
      us: overrides.usSteps ?? overrides.metricSteps,
    },
    keywords: [],
    categories: [],
  } as unknown as RecipeExtractionOutput;
}

function makeNormalized(overrides: Partial<FullRecipeInsertDTO> = {}): FullRecipeInsertDTO {
  return {
    name: "Test Recipe",
    servings: 4,
    systemUsed: "metric",
    url: null,
    recipeIngredients: [],
    steps: [],
    tags: [],
    categories: [],
    ...overrides,
  } as unknown as FullRecipeInsertDTO;
}

/** Every string the logger must NEVER carry, for the T-27-05 assertions. */
function loggedPayloads(): string {
  return JSON.stringify(logSpy.error.mock.calls) + JSON.stringify(logSpy.warn.mock.calls);
}

beforeEach(() => {
  forceParseNull = false;
  logSpy.debug.mockClear();
  logSpy.info.mockClear();
  logSpy.warn.mockClear();
  logSpy.error.mockClear();
});

// --------------------------------------------------------------------------

describe("buildCookFromExtraction — the happy path", () => {
  it("mints a self-validating .cook from the native system's per-step linkage", () => {
    const output = makeOutput({
      name: "Simple Pancakes",
      metricFlat: ["200 g flour", "300 ml milk", "2 egg", "salt", "15 g butter"],
      metricSteps: [
        {
          text: "Whisk the flour, milk, egg and salt into a smooth batter.",
          ingredients: [
            { name: "flour", amount: 200, unit: "gram" },
            { name: "milk", amount: 300, unit: "milliliter" },
            { name: "egg", amount: 2, unit: null },
            { name: "salt", amount: null, unit: null },
          ],
        },
        {
          text: "Heat a little butter in a frying pan.",
          ingredients: [{ name: "butter", amount: 15, unit: "gram" }],
          timers: [{ name: null, amount: 2, unit: "minutes" }],
        },
      ],
    });

    const cook = buildCookFromExtraction(
      output,
      makeNormalized({ name: "Simple Pancakes" }),
      units
    );

    expect(cook).not.toBeNull();
    expect(cook!.cookSource).toContain("@flour{200%gram}");
    expect(cook!.cookSource).toContain("~{2%minutes}");
    expect(() => CookTokensSchema.parse(cook!.cookTokens)).not.toThrow();
    expect(cook!.cookTokens).toHaveLength(2);
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("picks the US steps and US flat list when the recipe's native system is US", () => {
    const output = makeOutput({
      metricFlat: ["240 ml milk"],
      usFlat: ["1 cup milk"],
      metricSteps: [
        {
          text: "Pour the milk.",
          ingredients: [{ name: "milk", amount: 240, unit: "milliliter" }],
        },
      ],
      usSteps: [
        { text: "Pour the milk.", ingredients: [{ name: "milk", amount: 1, unit: "cup" }] },
      ],
    });

    const cook = buildCookFromExtraction(output, makeNormalized({ systemUsed: "us" }), units);

    expect(cook).not.toBeNull();
    expect(cook!.cookSource).toContain("norish.system: us");
    expect(cook!.cookSource).toContain("@milk{1%cup}");
    expect(cook!.cookSource).not.toContain("milliliter");
  });

  it("carries the recipe's metadata into the .cook front matter", () => {
    const output = makeOutput({
      metricFlat: ["1 onion"],
      metricSteps: [
        { text: "Chop the onion.", ingredients: [{ name: "onion", amount: 1, unit: null }] },
      ],
    });

    const cook = buildCookFromExtraction(
      output,
      makeNormalized({
        name: "Onion Thing",
        servings: 6,
        prepMinutes: 5,
        cookMinutes: 20,
        totalMinutes: 25,
        url: "https://example.com/onion",
      }),
      units
    );

    expect(cook!.cookSource).toContain("title: Onion Thing");
    expect(cook!.cookSource).toContain("servings: 6");
    expect(cook!.cookSource).toContain("https://example.com/onion");
  });
});

describe("refusal 1 — no per-step linkage is the ORDINARY case (D-27-W3-03)", () => {
  it("returns null for an all-strings extraction and does NOT log at error level", () => {
    const output = makeOutput({
      metricFlat: ["200 g flour"],
      metricSteps: ["Whisk the flour into a batter.", "Fry until golden."],
    });

    const cook = buildCookFromExtraction(output, makeNormalized(), units);

    expect(cook).toBeNull();
    expect(logSpy.error).not.toHaveBeenCalled();
    expect(logSpy.debug).toHaveBeenCalled();

    const debugPayload = JSON.stringify(logSpy.debug.mock.calls);

    expect(debugPayload).toContain("no-step-linkage");
    // T-27-05: counts only, never prose.
    expect(debugPayload).not.toContain("Whisk the flour");
    expect(debugPayload).not.toContain("flour");
  });

  it("returns null when every step object carries an EMPTY ingredients array", () => {
    const output = makeOutput({
      metricFlat: ["200 g flour"],
      metricSteps: [
        { text: "Whisk the flour into a batter.", ingredients: [] },
        {
          text: "Fry until golden.",
          ingredients: [],
          timers: [{ name: null, amount: 3, unit: "minutes" }],
        },
      ],
    });

    expect(buildCookFromExtraction(output, makeNormalized(), units)).toBeNull();
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("returns null, never throws, for a mangled recipeInstructions value", () => {
    for (const mangled of [null, undefined, 42, "not an array", [null], [{}], [42]]) {
      const output = makeOutput({ metricFlat: ["salt"], metricSteps: [] });

      (output as unknown as { recipeInstructions: unknown }).recipeInstructions = {
        metric: mangled,
        us: mangled,
      };

      expect(() => buildCookFromExtraction(output, makeNormalized(), units)).not.toThrow();
      expect(buildCookFromExtraction(output, makeNormalized(), units)).toBeNull();
    }
  });
});

describe("refusal 2 — THE COVERAGE GATE (D-27-W3-04)", () => {
  /** 11 flat ingredients; the caller decides how many the steps reference. */
  function coverageOutput(referenced: number): RecipeExtractionOutput {
    const names = [
      "onion",
      "garlic",
      "olive oil",
      "minced beef",
      "chopped tomatoes",
      "tomato paste",
      "salt",
      "spaghetti",
      "parmesan",
      "basil",
      "pepper",
    ];

    return makeOutput({
      name: "Spaghetti Bolognese",
      metricFlat: names,
      metricSteps: names.slice(0, referenced).map((name) => ({
        text: `Add the ${name} to the pan.`,
        ingredients: [{ name, amount: null, unit: null }],
      })),
    });
  }

  it("REFUSES when the steps reference only 8 of 11 flat ingredients", () => {
    const cook = buildCookFromExtraction(coverageOutput(8), makeNormalized(), units);

    expect(cook).toBeNull();

    const payload = loggedPayloads();

    expect(logSpy.error).toHaveBeenCalledTimes(1);
    expect(payload).toContain("incomplete-ingredient-coverage");
    expect(payload).toContain('"flatCount":11');
    expect(payload).toContain('"missingCount":3');
  });

  it("logs COUNTS ONLY — never the missing ingredient names or any step prose (T-27-05)", () => {
    buildCookFromExtraction(coverageOutput(8), makeNormalized(), units);

    const payload = loggedPayloads();

    for (const secret of ["parmesan", "basil", "pepper", "Spaghetti Bolognese", "Add the"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("MINTS when all 11 are referenced (the sibling case)", () => {
    const cook = buildCookFromExtraction(coverageOutput(11), makeNormalized(), units);

    expect(cook).not.toBeNull();
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("is not fooled by EXTRA refs beyond the flat list — those are not a failure", () => {
    const output = makeOutput({
      metricFlat: ["200 g flour", "salt"],
      metricSteps: [
        {
          text: "Whisk the flour with salt and a splash of water.",
          ingredients: [
            { name: "flour", amount: 200, unit: "gram" },
            { name: "salt", amount: null, unit: null },
            { name: "water", amount: null, unit: null },
          ],
        },
      ],
    });

    expect(buildCookFromExtraction(output, makeNormalized(), units)).not.toBeNull();
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  describe("loose matching, in exactly two directions", () => {
    function coverageOf(flat: string[], refNames: string[]) {
      const output = makeOutput({
        metricFlat: flat,
        metricSteps: [
          {
            text: `Combine ${refNames.join(" and ")}.`,
            ingredients: refNames.map((name) => ({ name, amount: null, unit: null })),
          },
        ],
      });

      return buildCookFromExtraction(output, makeNormalized(), units);
    }

    it('direction 1: flat "100 g plain flour" is covered by ref "flour"', () => {
      expect(coverageOf(["100 g plain flour"], ["flour"])).not.toBeNull();
    });

    it('direction 2: flat "salt" is covered by ref "salt to taste"', () => {
      expect(coverageOf(["salt"], ["salt to taste"])).not.toBeNull();
    });

    it('THE WHOLE-WORD RULE: flat "sugar" is NOT covered by ref "brown sugar" alone', () => {
      expect(coverageOf(["sugar"], ["brown sugar"])).toBeNull();
      expect(loggedPayloads()).toContain("incomplete-ingredient-coverage");
    });

    it('but flat "sugar" IS covered once a "sugar" ref also exists', () => {
      expect(coverageOf(["sugar", "brown sugar"], ["brown sugar", "sugar"])).not.toBeNull();
    });

    it('does not match on a partial word: flat "flourish" is not covered by ref "flour"', () => {
      expect(coverageOf(["flourish"], ["flour"])).toBeNull();
    });

    it("matches case- and whitespace-insensitively, and through punctuation", () => {
      expect(coverageOf(["oil or melted BUTTER,  for frying"], ["butter"])).not.toBeNull();
    });

    /**
     * DOCUMENTED, DELIBERATE FALSE NEGATIVE — measured, not assumed.
     *
     * A model that writes `"2 eggs"` in `recipeIngredient` and `"egg"` in a step's
     * refs earns NO `.cook`, purely on the English plural. Nothing is lost when
     * that happens (legacy projection, successful import), and the alternative —
     * morphological matching — is language-specific in an app whose fixtures
     * include Dutch (`gehakt`, `tomatenpuree`), so an "-s" rule would behave
     * inconsistently by locale and could newly collide names the way "sugar" /
     * "brown sugar" must not. The rule stays exact in W3; the refusal rate this
     * causes is recorded in the SUMMARY as a prompt/eval finding for W5, which
     * owns both the backfill and the evaluation harness.
     */
    it("does NOT bridge a singular/plural mismatch — a known, recorded refusal driver", () => {
      expect(coverageOf(["2 eggs"], ["egg"])).toBeNull();
      expect(coverageOf(["2 egg"], ["egg"])).not.toBeNull();
    });
  });
});

describe("refusal 3 — a size cap breach (T-27-01) never fails the write", () => {
  it("returns null with an input-too-large log when maxTotalIngredientRefs is breached", () => {
    // 601 refs across 11 steps: over `maxTotalIngredientRefs` (600) but under
    // `maxIngredientRefsPerStep` (60) x steps, so THIS cap is the one that fires.
    const names = Array.from({ length: 601 }, (_, i) => `ingredient${i}`);
    const steps: StepInput[] = [];

    for (let start = 0; start < names.length; start += 55) {
      const chunk = names.slice(start, start + 55);

      steps.push({
        text: `Add ${chunk.join(", ")}.`,
        ingredients: chunk.map((name) => ({ name, amount: null, unit: null })),
      });
    }

    const output = makeOutput({ metricFlat: names, metricSteps: steps });
    const cook = buildCookFromExtraction(output, makeNormalized(), units);

    expect(cook).toBeNull();

    const payload = loggedPayloads();

    expect(payload).toContain("input-too-large");
    expect(payload).toContain("maxTotalIngredientRefs");
    expect(payload).not.toContain("Test Recipe");
  });
});

describe("refusal 4 — output that does not parse cleanly (D-27-W2-04)", () => {
  it("returns null with a did-not-parse-cleanly log, and no recipe prose", () => {
    forceParseNull = true;

    const output = makeOutput({
      metricFlat: ["200 g flour"],
      metricSteps: [
        {
          text: "Whisk the flour into a smooth batter.",
          ingredients: [{ name: "flour", amount: 200, unit: "gram" }],
        },
      ],
    });

    const cook = buildCookFromExtraction(
      output,
      makeNormalized({ name: "Secret Pancakes" }),
      units
    );

    expect(cook).toBeNull();

    const payload = loggedPayloads();

    expect(payload).toContain("did-not-parse-cleanly");
    expect(payload).not.toContain("Secret Pancakes");
    expect(payload).not.toContain("Whisk the flour");
  });
});

// --------------------------------------------------------------------------
// D-27-W3-07 — the measurement the director is waiting on
// --------------------------------------------------------------------------

/**
 * The five committed fixtures, given an AI-style US flat ingredient list.
 *
 * The US lines deliberately reuse the metric refs' ingredient WORDS, because the
 * question this measurement answers is about UNITS, not naming: "is the list
 * `deriveProjectionTx` derives from the metric `.cook` worse than the one the
 * model gives us for free?" The amounts are ordinary US conversions of the
 * fixtures' metric amounts, as a model would emit them.
 */
const AI_US_LISTS: Record<string, string[]> = {
  pancakes: ["1 2/3 cups flour", "1 1/4 cups milk", "2 egg", "salt", "1 tablespoon butter"],
  bolognese: [
    "1 onion",
    "2 clove garlic",
    "2 tablespoon olive oil",
    "1 pound minced beef",
    "14 ounce chopped tomatoes",
    "2 tablespoon tomato paste",
    "salt",
    "14 ounce spaghetti",
    "1/2 cup parmesan",
  ],
  guacamole: ["3 avocado", "1 lime", "0.5 red onion", "1 tomato", "salt", "1/3 cup cilantro"],
  cookies: [
    "1/2 cup butter",
    "1/2 cup sugar",
    "3/4 cup brown sugar",
    "1 egg",
    "1 teaspoon vanilla",
    "2 cups flour",
    "1 teaspoon baking soda",
    "1 1/4 cups chocolate chips",
  ],
  curry: [
    "3 tablespoon green curry paste",
    "1 2/3 cups coconut milk",
    "1 pound chicken",
    "1 tablespoon fish sauce",
    "7 ounce bamboo shoots",
    "1/2 cup Thai basil",
    "1 1/2 cups rice",
  ],
};

describe("D-27-W3-07 — AI-emitted US ingredients vs the derived ones", () => {
  const report: string[] = [];

  for (const fixture of fixtures) {
    it(`"${fixture.slug}": the derived US list loses no ingredient`, () => {
      const aiUsLines = AI_US_LISTS[fixture.slug];

      expect(aiUsLines, `no AI US list authored for ${fixture.slug}`).toBeDefined();

      const metricSteps: StepInput[] = fixture.recipe.steps.map((step) => ({
        text: step.text,
        ingredients: (step.ingredients ?? []).map((ref) => ({
          name: ref.name,
          amount: ref.amount ?? null,
          unit: ref.unit ?? null,
        })),
        timers: (step.timers ?? []).map((timer) => ({
          name: timer.name ?? null,
          amount: timer.amount,
          unit: timer.unit,
        })),
      }));

      const output = makeOutput({
        name: fixture.recipe.name,
        metricFlat: fixture.flatIngredients.map((ing) => ing.name),
        usFlat: aiUsLines!,
        metricSteps,
      });

      const cook = buildCookFromExtraction(
        output,
        makeNormalized({ name: fixture.recipe.name, systemUsed: "metric" }),
        units
      );

      expect(cook, `${fixture.slug} must mint a .cook`).not.toBeNull();

      // What `deriveProjectionTx` will write for the OPPOSITE (US) system.
      const projection = computeCookProjection({
        systemUsed: "metric",
        cookTokens: cook!.cookTokens,
        units,
      });

      const aiParsed = parseIngredientWithDefaults(aiUsLines!, units);
      const aiByName = new Map(
        aiParsed.map((ing) => [
          ing.description.trim().toLowerCase(),
          { amount: ing.quantity ?? null, unit: ing.unitOfMeasureID ?? null },
        ])
      );
      const derivedByName = new Map(
        projection.derived.map((ing) => [
          ing.key,
          { amount: ing.amount ?? null, unit: ing.unit ?? null },
        ])
      );

      // HARD: same ingredients, same count. An ingredient may never be lost.
      expect([...derivedByName.keys()].sort()).toEqual([...aiByName.keys()].sort());
      expect(derivedByName.size).toBe(aiByName.size);

      // SOFT, but recorded: every unit difference.
      const differences: string[] = [];

      for (const [name, derived] of derivedByName) {
        const ai = aiByName.get(name);

        if (derived.unit !== (ai?.unit ?? null) || derived.amount !== (ai?.amount ?? null)) {
          differences.push(
            `${name}: AI=${ai?.amount ?? "null"} ${ai?.unit ?? "null"}` +
              ` | derived=${derived.amount ?? "null"} ${derived.unit ?? "null"}`
          );
        }
      }

      report.push(
        `${fixture.slug}: ${derivedByName.size} ingredients, ${differences.length} unit difference(s)` +
          (differences.length ? `\n    - ${differences.join("\n    - ")}` : "")
      );

      // The measurement must be non-vacuous: assert we actually compared something.
      expect(derivedByName.size).toBeGreaterThan(0);
    });
  }

  it("records the measurement for the SUMMARY", () => {
    expect(report).toHaveLength(fixtures.length);
    // eslint-disable-next-line no-console
    console.log(`\nD-27-W3-07 MEASUREMENT\n${report.join("\n")}\n`);
  });
});
