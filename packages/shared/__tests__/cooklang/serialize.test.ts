// Phase 27 (COOK-01) W1 — PURE serializer tests.
// No parser and no WASM in this package: `@norish/shared` is bundled by
// `apps/mobile` and its vitest environment is jsdom (D-27-W1-02). The
// structured -> .cook -> REAL WASM parser round-trip lives in
// `@norish/shared-server/__tests__/cooklang/round-trip.test.ts`.

import { describe, expect, it } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { StructuredRecipe } from "@norish/shared/cooklang";
import defaultUnits from "@norish/config/units.default.json";
import {
  COOK_FRONTMATTER_KEYS,
  COOK_FRONTMATTER_MAX_VALUE_CHARS,
  serializeWithReport,
  structuredToCooklang,
} from "@norish/shared/cooklang";

import { fixtures } from "./fixtures";

const unitsConfig = defaultUnits as UnitsMap;

function recipeOf(slug: string): StructuredRecipe {
  const fixture = fixtures.find((f) => f.slug === slug);

  if (!fixture) throw new Error(`unknown fixture: ${slug}`);

  return fixture.recipe;
}

describe("structuredToCooklang — document shape", () => {
  it("separates steps with a BLANK line (single newlines would merge them)", () => {
    const cook = structuredToCooklang(recipeOf("pancakes"));
    const body = cook.split("---\n").at(-1) ?? "";

    expect(body).toContain("\n\n");
    expect(body.trim().split("\n\n")).toHaveLength(3);
  });

  it("emits `== Heading ==` for a norish `#`-prefixed step", () => {
    const cook = structuredToCooklang(recipeOf("cookies"));

    expect(cook).toContain("== Dough ==");
    expect(cook).toContain("== Bake ==");
    expect(cook).not.toContain("# Dough");
  });

  it("emits YAML frontmatter carrying `norish.system` (D-2)", () => {
    const cook = structuredToCooklang(recipeOf("bolognese"));

    expect(cook.startsWith("---\n")).toBe(true);
    // REWRITTEN IN W3B (D-27-W3B-06 — H1), AND SAID OUT LOUD: these two assertions
    // used to read `title: Spaghetti Bolognese` and `norish.system: metric`, i.e.
    // they pinned UNQUOTED plain-scalar emission. That is what forced the recognizer
    // to accept plain scalars — and therefore very nearly arbitrary YAML — which is
    // the hole a 65 417-byte `a: [[[[…` frontmatter walked through (24-38 s of parse
    // time). Every non-numeric value is quoted unconditionally now, so the value
    // grammar is exactly `"…"` or a plain number.
    expect(cook).toContain('title: "Spaghetti Bolognese"');
    expect(cook).toContain('norish.system: "metric"');
  });

  it("emits numeric metadata UNQUOTED so the parser reports no diagnostic", () => {
    // Cooklang types `servings` as a number; `servings: "4"` produces
    // `Unsupported value for key: 'servings'`. Quoting is reserved for values
    // that would otherwise confuse YAML.
    const cook = structuredToCooklang(recipeOf("cookies"));

    expect(cook).toContain("\nservings: 24\n");
    expect(cook).toContain('time.prep: "15 min"');
    expect(cook).not.toContain('servings: "24"');
  });
});

describe("structuredToCooklang — ingredient tokens", () => {
  it("emits `@name{qty%unit}` with the CANONICAL unit ID in %unit (D-8)", () => {
    const cook = structuredToCooklang(recipeOf("bolognese"), unitsConfig);

    expect(cook).toContain("@minced beef{500%gram}");
    expect(cook).toContain("@olive oil{2%tablespoon}");
    expect(cook).toContain("@garlic{2%clove}");
  });

  it("emits `@name{qty}` when the ref has no unit", () => {
    const cook = structuredToCooklang(recipeOf("pancakes"), unitsConfig);

    expect(cook).toContain("@egg{2}");
  });

  it("emits a bare `@salt` for a single-word amount-less ingredient", () => {
    const cook = structuredToCooklang(recipeOf("guacamole"), unitsConfig);

    expect(cook).toContain("with @salt to taste");
    expect(cook).not.toContain("@salt{}");
  });

  it("emits `@sea salt{}` for a multi-word amount-less ingredient", () => {
    const cook = structuredToCooklang(
      {
        name: "Brine",
        systemUsed: "metric",
        steps: [
          {
            text: "Season the water with sea salt.",
            order: 0,
            ingredients: [{ name: "sea salt", amount: null, unit: null }],
          },
        ],
      },
      unitsConfig
    );

    expect(cook).toContain("@sea salt{}");
  });

  it("normalizes a known alternate unit to its canonical ID before writing %unit", () => {
    const recipe: StructuredRecipe = {
      name: "Alternates",
      systemUsed: "metric",
      steps: [
        {
          text: "Mix the flour with the oil.",
          order: 0,
          ingredients: [
            { name: "flour", amount: 200, unit: "gr" },
            { name: "oil", amount: 2, unit: "EL" },
          ],
        },
      ],
    };

    expect(structuredToCooklang(recipe, unitsConfig)).toContain("@flour{200%gram}");
    expect(structuredToCooklang(recipe, unitsConfig)).toContain("@oil{2%tablespoon}");
    // without a units config the serializer is identity-behaved on units
    expect(structuredToCooklang(recipe)).toContain("@flour{200%gr}");
  });

  it("matches the LONGEST ingredient name first: 'brown sugar' beats 'sugar'", () => {
    const cook = structuredToCooklang(recipeOf("cookies"), unitsConfig);

    expect(cook).toContain("@brown sugar{150%gram}");
    expect(cook).toContain("@sugar{100%gram}");
    // "brown sugar" must NOT have been tokenised as "brown @sugar{...}"
    expect(cook).not.toContain("brown @sugar");
  });

  it("keeps longest-name-first matching on a synthetic 'sugar syrup' step", () => {
    const cook = structuredToCooklang(
      {
        name: "Syrup",
        systemUsed: "metric",
        steps: [
          {
            text: "Stir the brown sugar into the sugar syrup.",
            order: 0,
            ingredients: [
              { name: "sugar syrup", amount: 100, unit: "milliliter" },
              { name: "brown sugar", amount: 50, unit: "gram" },
            ],
          },
        ],
      },
      unitsConfig
    );

    expect(cook).toContain("@brown sugar{50%gram}");
    expect(cook).toContain("@sugar syrup{100%milliliter}");
    expect(cook).not.toContain("brown @sugar");
  });
});

/**
 * H1 (D-27-W3B-06) — THE FRONTMATTER IS A CLOSED SHAPE, ASSERTED AT THE EMITTER.
 *
 * The recognizer in `@norish/shared-server/cooklang/limits` accepts exactly two
 * value shapes, `"…"` and a plain number, and imports `COOK_FRONTMATTER_KEYS` from
 * here so the key set has ONE definition. These tests are the emitter's half: what
 * comes out is inside that grammar for every input, including the inputs that used
 * to slip out unquoted.
 */
describe("structuredToCooklang — the closed frontmatter shape (H1)", () => {
  /** The frontmatter lines of a `.cook`, without the `---` fences. */
  function frontmatterLinesOf(cook: string): string[] {
    const end = cook.indexOf("\n---\n", 3);

    expect(cook.startsWith("---\n")).toBe(true);
    expect(end).toBeGreaterThan(0);

    return cook.slice(4, end).split("\n");
  }

  const HOSTILE_METADATA = [
    "[".repeat(400),
    "{".repeat(400),
    "&anchor",
    "*alias",
    "!!str x",
    "| block",
    "> folded",
    "# comment",
    "a: b",
    "---",
    "...",
    '"quoted"',
    "back\\slash",
    "1.50",
    "0",
    "@@@@ ####",
    "  padded  ",
    "\ttabbed\t",
    "tab\tinside",
    "line\nbreak",
    "180°C (350°F)",
    "麻婆豆腐",
    "Café @ Home",
  ];

  it("emits only `key: \"…\"` or `key: <number>`, for every hostile metadata value", () => {
    const failures: string[] = [];

    for (const hostile of HOSTILE_METADATA) {
      const cook = structuredToCooklang(
        {
          name: hostile,
          source: hostile,
          servings: 4,
          prepMinutes: 15,
          systemUsed: "metric",
          steps: [{ text: "Mix it.", order: 0, ingredients: [] }],
        },
        unitsConfig
      );

      for (const line of frontmatterLinesOf(cook)) {
        const separator = line.indexOf(": ");
        const key = line.slice(0, separator);
        const value = line.slice(separator + 2);
        const shaped =
          COOK_FRONTMATTER_KEYS.includes(key as (typeof COOK_FRONTMATTER_KEYS)[number]) &&
          (/^-?\d+(?:\.\d+)?$/.test(value) ||
            (value.startsWith('"') && value.endsWith('"') && value.length > 2));

        if (!shaped) failures.push(`${JSON.stringify(hostile)} -> ${JSON.stringify(line)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps `servings` a BARE number and quotes everything else", () => {
    const cook = structuredToCooklang(
      {
        name: "Quoted",
        servings: 4,
        prepMinutes: 15,
        cookMinutes: 30,
        source: "https://example.test/a",
        systemUsed: "us",
        steps: [{ text: "Mix it.", order: 0, ingredients: [] }],
      },
      unitsConfig
    );

    expect(cook).toContain("\nservings: 4\n");
    expect(cook).toContain('title: "Quoted"');
    expect(cook).toContain('time.prep: "15 min"');
    expect(cook).toContain('time.cook: "30 min"');
    expect(cook).toContain('source: "https://example.test/a"');
    expect(cook).toContain('norish.system: "us"');
  });

  it("OMITS a key rather than emitting a value the recognizer would refuse", () => {
    // A `source` longer than the per-value maximum, and a `servings` that
    // `String(Number(x))` renders in exponential notation, are both unrepresentable
    // inside the closed grammar. Dropping optional METADATA keeps the recipe's
    // `cook_source` (the DB columns remain the source of truth for both fields);
    // emitting them unrecognizably would cost the recipe its whole read model.
    const cook = structuredToCooklang(
      {
        name: "Edge",
        servings: 1e21,
        source: `https://example.test/${"a".repeat(COOK_FRONTMATTER_MAX_VALUE_CHARS)}`,
        systemUsed: "metric",
        steps: [{ text: "Mix it.", order: 0, ingredients: [] }],
      },
      unitsConfig
    );

    expect(cook).not.toContain("servings:");
    expect(cook).not.toContain("source:");
    expect(cook).toContain('title: "Edge"');

    for (const line of frontmatterLinesOf(cook)) {
      expect(line.slice(line.indexOf(": ") + 2).length).toBeLessThanOrEqual(
        COOK_FRONTMATTER_MAX_VALUE_CHARS
      );
    }
  });

  it("emits an all-whitespace metadata value as NO key at all", () => {
    const cook = structuredToCooklang(
      {
        name: "   ",
        source: " \t ",
        systemUsed: "metric",
        steps: [{ text: "Mix it.", order: 0, ingredients: [] }],
      },
      unitsConfig
    );

    expect(frontmatterLinesOf(cook)).toEqual(['norish.system: "metric"']);
  });

  it("emits each key at most once, in the closed set's order", () => {
    const keys = frontmatterLinesOf(
      structuredToCooklang(
        {
          name: "Ordered",
          servings: 2,
          prepMinutes: 5,
          cookMinutes: 10,
          source: "https://example.test/b",
          systemUsed: "metric",
          steps: [{ text: "Mix it.", order: 0, ingredients: [] }],
        },
        unitsConfig
      )
    ).map((line) => line.slice(0, line.indexOf(": ")));

    expect(keys).toEqual([...COOK_FRONTMATTER_KEYS]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * H2 (D-27-W3B-07) — THE SERIALIZER CANNOT EMIT A WHITESPACE-ONLY AMOUNT OR UNIT.
 *
 * `@a{ %g}` is nine bytes and it panics the WASM parser with `RuntimeError:
 * unreachable`; `~a{ %m}` and `#a{ %g}` do the same. `f7bcecb8` guarded the EMPTY
 * case and missed the whitespace-only one, and the pre-W3B `formatTokenAmount` made
 * it worse in a second way: `Number(" ")` is `0`, so a blank amount emitted
 * `@flour{0%gram}` — a quantity the extraction never carried.
 *
 * The property asserted here is two-sided: no forbidden shape is emitted, AND NO REF
 * IS DROPPED. Dropping one would drop an ingredient ROW, because the projection
 * builds rows from the tokens.
 */
describe("structuredToCooklang — no whitespace-only amount or unit (H2)", () => {
  const BLANKS = ["", " ", "\t", " ", "  ", " \t ", " "];
  const FORBIDDEN = ["{ ", " }", "{ }", "{%}", "{ %", "% }", "{\t", "\t}"];

  for (const blank of BLANKS) {
    it(`emits no blank-quantity shape for an amount/unit of ${JSON.stringify(blank)}`, () => {
      const cook = structuredToCooklang(
        {
          name: "Blanks",
          systemUsed: "metric",
          steps: [
            {
              text: "Add flour and sugar, then rest.",
              order: 0,
              ingredients: [
                { name: "flour", amount: blank, unit: "gram" },
                { name: "sugar", amount: 2, unit: blank },
              ],
              timers: [{ name: "rest", amount: blank, unit: blank }],
            },
          ],
        },
        unitsConfig
      );

      for (const shape of FORBIDDEN) {
        expect(cook, `${JSON.stringify(blank)} produced ${shape}`).not.toContain(shape);
      }

      // NOTHING IS DROPPED: both refs are still tokens, and a blank amount degrades
      // to the amount-less form rather than inventing `0`.
      expect(cook).toContain("@flour");
      expect(cook).toContain("@sugar");
      expect(cook).not.toContain("{0%");
      expect(cook).not.toContain("@flour{0}");
    });
  }

  it("keeps a legitimate multi-word amount and unit, which carry INTERNAL spaces", () => {
    const cook = structuredToCooklang(
      {
        name: "Internal",
        systemUsed: "us",
        steps: [
          {
            text: "Add flour and milk.",
            order: 0,
            ingredients: [
              { name: "flour", amount: "1 1/2", unit: "cup" },
              { name: "milk", amount: 8, unit: "fl oz" },
            ],
          },
        ],
      },
      unitsConfig
    );

    expect(cook).toContain("@flour{1 1/2%cup}");
    expect(cook).toContain("@milk{8%fl oz}");
  });

  it("a blank amount keeps the reference and reports it as placed", () => {
    const { cook, links } = serializeWithReport(
      {
        name: "Blank amount",
        systemUsed: "metric",
        steps: [
          {
            text: "Season with sea salt.",
            order: 0,
            ingredients: [{ name: "sea salt", amount: " ", unit: " " }],
          },
        ],
      },
      unitsConfig
    );

    expect(links).toEqual([{ stepOrder: 0, ingredient: "sea salt", placement: "inline" }]);
    expect(cook).toContain("@sea salt{}");
  });
});

/**
 * H3 (D-27-W3B-08) — THE SERIALIZER USED TO DELETE TEXT THE USER TYPED.
 *
 * `splitFragment` removed `ref.name.length` characters at an index produced by
 * matching `normalizeIngredientLinkName(name)`, whose length DIFFERS on any leading,
 * trailing or internal extra whitespace. Measured, all minting silently:
 *
 *   | ingredient name   | step prose                    | emitted                        |
 *   |-------------------|-------------------------------|--------------------------------|
 *   | `"flour "`        | `"Add flour now."`            | `Add @flour{1%cup}now.`        |
 *   | `" flour "`       | `"Add flour now."`            | `Add @flour{1%cup}ow.`         |
 *   | `"brown  sugar"`  | `"Add brown sugar into…"`     | `…{1%cup}into the bowl.`       |
 *   | `"brown   sugar"` | `"Add brown sugar into…"`     | `…{1%cup}nto the bowl.`        |
 *
 * WHY THE 45-TEST ROUND-TRIP SUITE COULD NOT CATCH IT: that suite varies PROSE and
 * never a ref NAME's whitespace, so the two lengths were always equal in it. These
 * tests vary the ref name — leading, trailing, both, internal double and triple
 * space, TAB, NBSP, and a name whose lowercasing changes its LENGTH — crossed with
 * the ref at the start, the middle and the end of the step. The byte-identical
 * READ-side proof is in
 * `@norish/shared-server/__tests__/cooklang/round-trip-fidelity.test.ts`; this half
 * proves the emitted `.cook` keeps the surrounding prose intact.
 */
describe("structuredToCooklang — the matched SPAN, never ref.name.length (H3)", () => {
  const NAMES = [
    ["trailing space", "flour "],
    ["leading space", " flour"],
    ["both", " flour "],
    ["internal double space", "all  purpose"],
    ["internal triple space", "all   purpose"],
    ["a TAB", "all\tpurpose"],
    ["an NBSP", "all\u00a0purpose"],
    ["a newline", "all\npurpose"],
    // `"İ".toLowerCase()` is TWO code units, so the normalized needle is LONGER than
    // the text it matched: the same off-by-N through a different door.
    ["a name whose lowercasing changes length", "İstanbul spice"],
  ] as const;

  /** The prose each name must be found in, with the ref at three positions. */
  function proseFor(name: string): [string, string][] {
    const anchor = name.trim().replace(/\s+/g, " ");

    return [
      ["start", `${anchor} goes in first, then water.`],
      ["middle", `Add ${anchor} now.`],
      ["end", `Whisk the water into the ${anchor}`],
    ];
  }

  for (const [label, name] of NAMES) {
    it(`keeps the prose intact around a ref name with ${label}`, () => {
      for (const [position, text] of proseFor(name)) {
        const { cook, links } = serializeWithReport(
          {
            name: "Span",
            systemUsed: "us",
            steps: [{ text, order: 0, ingredients: [{ name, amount: 1, unit: "cup" }] }],
          },
          unitsConfig
        );
        const body = cook.split("---\n").at(-1) ?? "";
        // Reverse the token back to the prose it replaced: the emitted name, with
        // its escaping and its braces removed, must land back in the original text.
        const restored = body
          .replace(/@((?:\\.|[^{\n])*)(?:\{[^}\n]*\})?/g, (_match, token: string) =>
            token.replace(/\\(.)/g, "$1")
          )
          .replace(/\\(.)/g, "$1")
          .trimEnd();

        expect(links[0]?.placement, `${label} @ ${position}`).toBe("inline");
        expect(restored, `${label} @ ${position}`).toBe(text.trim());
      }
    });
  }

  it("the SPECIFIC measured H3 artefacts no longer eat a character", () => {
    function bodyOf(name: string, text: string): string {
      const cook = structuredToCooklang(
        {
          name: "Artefact",
          systemUsed: "us",
          steps: [{ text, order: 0, ingredients: [{ name, amount: 1, unit: "cup" }] }],
        },
        unitsConfig
      );

      return (cook.split("---\n").at(-1) ?? "").trim();
    }

    expect(bodyOf("flour ", "Add flour now.")).toBe("Add @flour{1%cup} now.");
    expect(bodyOf(" flour", "Add flour now.")).toBe("Add @flour{1%cup} now.");
    expect(bodyOf(" flour ", "Add flour now.")).toBe("Add @flour{1%cup} now.");
    expect(bodyOf("brown  sugar", "Add brown sugar into the bowl.")).toBe(
      "Add @brown sugar{1%cup} into the bowl."
    );
    expect(bodyOf("brown   sugar", "Add brown sugar into the bowl.")).toBe(
      "Add @brown sugar{1%cup} into the bowl."
    );
  });
});

describe("structuredToCooklang — timers", () => {
  it("emits an anonymous timer token `~{qty%unit}`", () => {
    const cook = structuredToCooklang(recipeOf("bolognese"), unitsConfig);

    expect(cook).toContain("~{30%minutes}");
  });

  it("emits a named timer token `~name{qty%unit}`", () => {
    const cook = structuredToCooklang(
      {
        name: "Rest",
        systemUsed: "metric",
        steps: [
          {
            text: "Let the dough rest.",
            order: 0,
            ingredients: [],
            timers: [{ name: "rest", amount: 45, unit: "minutes" }],
          },
        ],
      },
      unitsConfig
    );

    expect(cook).toContain("~rest{45%minutes}");
  });
});

describe("serializeWithReport — inline vs appended placement", () => {
  it("accounts for EVERY ingredient ref exactly once", () => {
    for (const fixture of fixtures) {
      const { links } = serializeWithReport(fixture.recipe, unitsConfig);
      const refCount = fixture.recipe.steps.reduce((n, s) => n + s.ingredients.length, 0);

      expect(links, fixture.slug).toHaveLength(refCount);
    }
  });

  it("resolves every ref inline in the hand-linked fixture set (0 appended)", () => {
    for (const fixture of fixtures) {
      const { links } = serializeWithReport(fixture.recipe, unitsConfig);

      expect(
        links.filter((l) => l.placement === "appended"),
        fixture.slug
      ).toHaveLength(0);
    }
  });

  it("APPENDS a ref with no textual anchor and reports placement:'appended'", () => {
    const { cook, links } = serializeWithReport(
      {
        name: "Garnished soup",
        systemUsed: "metric",
        steps: [
          {
            text: "Season and serve.",
            order: 0,
            ingredients: [{ name: "parmesan", amount: 50, unit: "gram" }],
          },
        ],
      },
      unitsConfig
    );

    expect(links).toEqual([{ stepOrder: 0, ingredient: "parmesan", placement: "appended" }]);
    expect(cook).toContain("Season and serve. @parmesan{50%gram}");
  });
});

describe("structuredToCooklang — purity", () => {
  it("returns a byte-identical string on every call", () => {
    for (const fixture of fixtures) {
      const first = structuredToCooklang(fixture.recipe, unitsConfig);
      const second = structuredToCooklang(fixture.recipe, unitsConfig);
      const third = structuredToCooklang(fixture.recipe, unitsConfig);

      expect(second, fixture.slug).toBe(first);
      expect(third, fixture.slug).toBe(first);
    }
  });

  it("does not mutate its input", () => {
    const recipe = recipeOf("curry");
    const before = JSON.stringify(recipe);

    structuredToCooklang(recipe, unitsConfig);

    expect(JSON.stringify(recipe)).toBe(before);
  });
});
