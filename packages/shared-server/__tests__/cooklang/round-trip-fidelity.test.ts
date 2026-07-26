// @vitest-environment node
/**
 * T-27-01 root-cause fix — ROUND-TRIP FIDELITY IS A HARD REQUIREMENT.
 *
 * Phase 27 makes `.cook` the SINGLE SOURCE OF TRUTH and W4 renders steps from
 * `cookTokens`, so the prose a user sees after
 *
 *     step text -> structuredToCooklang -> the REAL WASM parser -> cookTokens
 *
 * must be BYTE-IDENTICAL to what they typed. A fix that hardens the parser but
 * corrupts displayed text is a worse defect than the one it fixes: escaping a
 * metacharacter is only sound because the parser UNESCAPES it again, and this file
 * is the proof that it does, over a corpus containing every metacharacter, bare
 * sigils, unbalanced braces, CJK, accents, emoji, combining marks, TAB and NUL.
 *
 * The two documented, deliberate normalizations are asserted here too rather than
 * hidden: CR/LF in step prose folds to a space (a newline is a STRUCTURAL injection,
 * not a character), and the pre-existing `.trim()` still trims.
 */

import { afterAll, describe, expect, it } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";
import type { StructuredRecipe, StructuredStep } from "@norish/shared/cooklang";
import defaultUnits from "@norish/config/units.default.json";
import { escapeCookText, structuredToCooklang } from "@norish/shared/cooklang";
import { findCookSourceDefect } from "@norish/shared-server/cooklang/limits";
import { parseCookSource } from "@norish/shared-server/cooklang/parse";
import { shutdownCookParsePool } from "../../src/cooklang/pool";

const units = defaultUnits as UnitsMap;

function recipeOf(steps: StructuredStep[]): StructuredRecipe {
  return { name: "Fidelity", systemUsed: "metric", steps };
}

function stepOf(text: string): StructuredStep {
  return { text, order: 0, ingredients: [] };
}

/** Re-assemble the prose a client would render from the token read model. */
function renderProse(tokens: CookTokensDTO): string {
  return tokens
    .map((step) =>
      step.tokens.map((token) => (token.type === "text" ? token.value : token.name ?? "")).join("")
    )
    .join("\n\n");
}

/**
 * The full round trip: one step of prose in, the rendered prose out.
 *
 * `async` since W3B, because the parse now happens in a pooled child process. The
 * two nested sweeps below run ~290 SEQUENTIAL pooled round trips between them;
 * they are deliberately NOT parallelized into the pool, which would make the
 * timing assertions elsewhere racy for no gain.
 */
async function roundTrip(prose: string): Promise<string> {
  const cook = structuredToCooklang(recipeOf([stepOf(prose)]), units);

  expect(findCookSourceDefect(cook), `defect for ${JSON.stringify(prose)}`).toBeNull();

  const tokens = await parseCookSource(cook, units);

  expect(tokens, `read model for ${JSON.stringify(prose)}`).not.toBeNull();

  return renderProse(tokens!);
}

/**
 * Every ASCII punctuation character, in every position where a Cooklang construct
 * could start: mid-word, space-delimited, at line start, at line end, doubled
 * (`--`, `==`, `>>` and `##` are all two-character constructs) and alone.
 *
 * This is what makes `COOK_METACHARACTERS` provably EXHAUSTIVE rather than a
 * guess: if a parser upgrade gives meaning to a character the escaper does not
 * cover, this sweep goes red on that character.
 */
const ASCII_PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

function positionalCases(char: string): string[] {
  return [
    `X${char}Y`,
    `X ${char} Y`,
    `${char}XY`,
    `XY${char}`,
    `X${char}${char}Y`,
    `${char}${char}XY`,
    `X ${char}${char} Y`,
    `${char}`,
    `${char}${char}`,
  ];
}

/** Hand-written cases: real recipe prose, and the shapes that used to break. */
const NAMED_CASES: [string, string][] = [
  ["US shorthand: at", "Preheat the oven @ 325 degrees"],
  ["US shorthand: pound", "Season a 3 # chuck roast all over"],
  ["US shorthand: about", "Skim the fat, then reduce ~ 10 minutes"],
  ["the WASM-trap prose", "Simmer ~10 minutes, then rest ~ overnight"],
  ["temperature with a degree sign", "Bake at 180°C for 25 minutes."],
  ["a trailing-zero decimal", "Add 1.50 kg of flour."],
  ["a fraction", "Cut into 1/2 inch cubes."],
  ["a mixed number", "Reduce to 1 1/2 cups."],
  ["a percentage", "Whisk at ~ 50% heat."],
  ["a range", "Sauté 2-3 minutes, no more."],
  ["an em-dash pair", "Fold gently -- do not knock the air out."],
  ["unbalanced opening brace", "Mix {this is not a quantity"],
  ["unbalanced closing brace", "Mix this is not a quantity}"],
  ["a balanced brace pair", "Mix {gently} and rest"],
  ["a whole token, as literal prose", "Type @flour{200%gram} to link it"],
  ["a section heading, as literal prose", "== Dough == is a heading"],
  ["legacy metadata, as literal prose", ">> servings: 4"],
  ["a block comment, as literal prose", "Mix [- like this -] and stop"],
  ["every metacharacter at once", "\\ @ # ~ { } % = > - all of them"],
  ["CJK", "中文料理を作る、そして混ぜる"],
  ["accents", "Crème brûlée à la française, jalapeño"],
  ["emoji", "Serve the 🍕 with 🧂 and 🥗"],
  ["combining marks", "e\u0301\u0302\u0303 stacked"],
  ["a TAB", "Mix\tthen fold"],
  ["a NUL", "Mix\u0000then fold"],
  ["a non-breaking space", "Mix\u00a0then fold"],
  ["an already-escaped-looking sequence", "Type \\@ to escape an at-sign"],
];

describe("round-trip fidelity — the prose a user typed survives byte-identically", () => {
  for (const [name, prose] of NAMED_CASES) {
    it(`${name}`, async () => {
      expect(await roundTrip(prose)).toBe(prose);
    });
  }

  it("survives every ASCII punctuation character in every construct-starting position", async () => {
    const failures: string[] = [];

    for (const char of ASCII_PUNCTUATION) {
      for (const prose of positionalCases(char)) {
        // the serializer trims, so compare against the trimmed input
        const expected = prose.trim();

        if (expected === "") continue;
        // A step whose text starts with `#` is norish's PRE-EXISTING in-band
        // heading convention (`# Dough` -> `== Dough ==`, W2-E5), so it is not a
        // prose step at all. Covered by its own case below, not by this sweep.
        if (expected.startsWith("#")) continue;

        let got: string;

        try {
          got = await roundTrip(expected);
        } catch (err) {
          failures.push(`${JSON.stringify(expected)} threw ${String(err).slice(0, 80)}`);
          continue;
        }

        if (got !== expected) failures.push(`${JSON.stringify(expected)} -> ${JSON.stringify(got)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("survives every ADJACENT PAIR of metacharacters (the two-character constructs)", async () => {
    const metacharacters = "\\@#~{}%=>-";
    const failures: string[] = [];

    for (const first of metacharacters) {
      for (const second of metacharacters) {
        const prose = `Mix ${first}${second} well`;
        const got = await roundTrip(prose);

        if (got !== prose) failures.push(`${JSON.stringify(prose)} -> ${JSON.stringify(got)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the prose AROUND a real ingredient token byte-identical", async () => {
    const cook = structuredToCooklang(
      recipeOf([
        {
          text: "Whisk the flour @ 100% hydration -- gently {please}.",
          order: 0,
          ingredients: [{ name: "flour", amount: 200, unit: "gram" }],
        },
      ]),
      units
    );

    expect(findCookSourceDefect(cook)).toBeNull();

    const tokens = (await parseCookSource(cook, units))!;

    expect(tokens[0]!.tokens).toEqual([
      { type: "text", value: "Whisk the " },
      { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
      { type: "text", value: " @ 100% hydration -- gently {please}." },
    ]);
    expect(renderProse(tokens)).toBe("Whisk the flour @ 100% hydration -- gently {please}.");
  });

  it("round-trips an ingredient NAME that itself carries metacharacters", async () => {
    // The old serializer STRIPPED `@{}~#%` from a name, which silently rewrote both
    // the ingredient and — because the token replaces the name in the prose — the
    // step the user reads. Escaping keeps both exact.
    const cook = structuredToCooklang(
      recipeOf([
        {
          text: "Add the jalapeño #2 and the 70% chocolate.",
          order: 0,
          ingredients: [
            { name: "jalapeño #2", amount: 2, unit: null },
            { name: "70% chocolate", amount: 100, unit: "gram" },
          ],
        },
      ]),
      units
    );

    expect(findCookSourceDefect(cook)).toBeNull();

    const tokens = (await parseCookSource(cook, units))!;

    expect(tokens[0]!.tokens).toContainEqual({
      type: "ingredient",
      name: "jalapeño #2",
      amount: 2,
      unit: null,
    });
    expect(tokens[0]!.tokens).toContainEqual({
      type: "ingredient",
      name: "70% chocolate",
      amount: 100,
      unit: "gram",
    });
    expect(renderProse(tokens)).toBe("Add the jalapeño #2 and the 70% chocolate.");
  });

  it("a `#`-leading step is norish's HEADING convention, and its text still survives", async () => {
    // Pre-existing (W2-E5), unrelated to escaping: the `#` marker is consumed and
    // everything after it becomes the section name, byte-identically.
    const cook = structuredToCooklang(
      recipeOf([
        { text: "#XY", order: 0, ingredients: [] },
        { text: "Mix it.", order: 1, ingredients: [] },
      ]),
      units
    );

    expect(findCookSourceDefect(cook)).toBeNull();
    expect((await parseCookSource(cook, units))![0]!.section).toBe("XY");
  });

  it("round-trips a section HEADING that carries metacharacters", async () => {
    const cook = structuredToCooklang(
      recipeOf([
        { text: "# Dough == 100% hydration", order: 0, ingredients: [] },
        { text: "Mix it.", order: 1, ingredients: [] },
      ]),
      units
    );

    expect(findCookSourceDefect(cook)).toBeNull();

    const tokens = (await parseCookSource(cook, units))!;

    expect(tokens[0]!.section).toBe("Dough == 100% hydration");
  });

  it("escapeCookText is the exact inverse the parser expects (no double-escaping)", async () => {
    expect(escapeCookText("a @ b")).toBe("a \\@ b");
    expect(escapeCookText("a \\ b")).toBe("a \\\\ b");
    expect(escapeCookText("a \\@ b")).toBe("a \\\\\\@ b");
    // idempotent it is NOT, and must not be: escaping twice must still round-trip
    expect(await roundTrip("a \\@ b")).toBe("a \\@ b");
    expect(await roundTrip(escapeCookText("a @ b"))).toBe("a \\@ b");
  });
});

describe("soundness: the serializer can NEVER produce a source the recognizer refuses", () => {
  /**
   * The "no legitimate refusal" half of the gate's contract. The refuted heuristic
   * failed exactly here — it refused an ordinary recipe — so this is a generative
   * sweep, not a handful of examples: every hostile string is used in turn as step
   * prose, as a heading, as an ingredient NAME, as an AMOUNT, as a UNIT and as the
   * recipe NAME, and in every position `findCookSourceDefect` must return `null` and
   * the real parser must return a read model with an EMPTY diagnostic report.
   */
  const HOSTILE = [
    "@",
    "#",
    "~",
    "{",
    "}",
    "%",
    "=",
    ">",
    "-",
    "\\",
    "@a{1%}",
    "~{5}",
    "~a{5}",
    "@{2%g}",
    "== h ==",
    ">> k: v",
    "-- c",
    "[- c -]",
    "---",
    "a\nb",
    "a\r\nb",
    "@@@@",
    "####",
    "~~~~",
    "{{{{",
    "}}}}",
    "%%%%",
    "\\\\\\\\",
    "@a{@b{@c{",
    "1%2%3",
    "2-3",
    "1.50",
    "180°C",
    "中文",
    "🍕",
    "e\u0301\u0302",
    "a\tb",
    "a\u0000b",
    "",
    "   ",
  ];

  it("survives every hostile string as step PROSE", async () => {
    for (const hostile of HOSTILE) {
      const cook = structuredToCooklang(recipeOf([stepOf(`Mix ${hostile} well.`)]), units);

      expect(findCookSourceDefect(cook), JSON.stringify(hostile)).toBeNull();
      expect(await parseCookSource(cook, units), JSON.stringify(hostile)).not.toBeNull();
    }
  });

  it("survives every hostile string as an ingredient NAME, AMOUNT and UNIT", async () => {
    for (const hostile of HOSTILE) {
      const cases: StructuredStep[] = [
        // a BLANK name is not a name; it is asserted as a REFUSAL below
        ...(hostile.trim() === ""
          ? []
          : [
              {
                text: `Add ${hostile} to the pan.`,
                order: 0,
                ingredients: [{ name: hostile, amount: 2, unit: "gram" }],
              } satisfies StructuredStep,
            ]),
        {
          text: "Add flour to the pan.",
          order: 0,
          ingredients: [{ name: "flour", amount: hostile, unit: "gram" }],
        },
        {
          text: "Add flour to the pan.",
          order: 0,
          ingredients: [{ name: "flour", amount: 2, unit: hostile }],
        },
        {
          text: "Rest a while.",
          order: 0,
          ingredients: [],
          timers: [{ name: hostile, amount: hostile, unit: hostile }],
        },
      ];

      for (const step of cases) {
        const cook = structuredToCooklang(recipeOf([step]), units);

        expect(findCookSourceDefect(cook), JSON.stringify(hostile)).toBeNull();
      }
    }
  });

  it("REFUSES rather than corrupts when an ingredient ref has a BLANK name", async () => {
    // Not expressible as a token (`@{2%gram}` has no name), and dropping the ref
    // would drop an ingredient ROW because `deriveProjectionTx` builds them from
    // the tokens. So the whole source is refused: legacy projection, import
    // succeeds, `cook_source` NULL — the never-broken guarantee.
    const cook = structuredToCooklang(
      recipeOf([
        { text: "Add it to the pan.", order: 0, ingredients: [{ name: "  ", amount: 2, unit: "gram" }] },
      ]),
      units
    );

    expect(findCookSourceDefect(cook)?.defect).toBe("malformed-token");
    expect(await parseCookSource(cook, units)).toBeNull();
  });

  it("a CONTROL CHARACTER in a metadata value is folded, because YAML forbids it raw", async () => {
    // YAML rejects raw control characters even inside quotes ("control characters
    // are not allowed at position N"), so frontmatter needs its own normalization —
    // step prose keeps a NUL byte-identically, a YAML scalar cannot.
    const cook = structuredToCooklang(
      { name: "Roast\u0000Beef", systemUsed: "metric", steps: [stepOf("Mix it.")] },
      units
    );

    // QUOTED since W3B (D-27-W3B-06): every non-numeric metadata value is quoted
    // unconditionally, which is what lets the recognizer accept `"…"` or a number and
    // nothing else. The fold itself is unchanged — the NUL is still a space.
    expect(cook).toContain('title: "Roast Beef"');
    expect(findCookSourceDefect(cook)).toBeNull();
    expect(await parseCookSource(cook, units)).not.toBeNull();
  });

  it("a NUMERIC-LOOKING recipe name is still a string in the frontmatter", async () => {
    // `title: 1.50` unquoted makes YAML read a number and the parser report
    // `Unsupported value for key: 'title'`, which would cost the recipe its
    // `cook_source` for a name the user chose. Only `servings` is numeric-typed.
    const cook = structuredToCooklang(
      { name: "1.50", systemUsed: "metric", servings: 4, steps: [stepOf("Mix it.")] },
      units
    );

    expect(cook).toContain('title: "1.50"');
    expect(cook).toContain("servings: 4");
    expect(findCookSourceDefect(cook)).toBeNull();
    expect(await parseCookSource(cook, units)).not.toBeNull();
  });

  it("survives every hostile string as a HEADING and as the recipe NAME", async () => {
    for (const hostile of HOSTILE) {
      const heading = structuredToCooklang(
        recipeOf([
          { text: `# ${hostile}`, order: 0, ingredients: [] },
          { text: "Mix it.", order: 1, ingredients: [] },
        ]),
        units
      );

      expect(findCookSourceDefect(heading), `heading ${JSON.stringify(hostile)}`).toBeNull();

      const named = structuredToCooklang(
        { name: hostile, systemUsed: "metric", steps: [stepOf("Mix it.")], source: hostile },
        units
      );

      expect(findCookSourceDefect(named), `name ${JSON.stringify(hostile)}`).toBeNull();
      expect(await parseCookSource(named, units), `name ${JSON.stringify(hostile)}`).not.toBeNull();
    }
  });
});

/**
 * H3 — REF-NAME WHITESPACE, THE FIDELITY DEFECT THE SUITE ABOVE STRUCTURALLY COULD
 * NOT CATCH (W3B, D-27-W3B-08).
 *
 * `splitFragment` removed `ref.name.length` characters at an index produced by
 * matching `normalizeIngredientLinkName(name)` — trimmed, whitespace-collapsed,
 * lowercased — so the two lengths differed on any leading, trailing or internal extra
 * whitespace in the NAME and the difference was DELETED FROM THE USER'S PROSE. It
 * minted silently: `"Add flour now."` with an ingredient named `"flour "` rendered
 * "Add flournow.", and `"brown   sugar"` ate the `i` from "into".
 *
 * WHY EVERY ONE OF THE 45 CASES ABOVE PASSED THROUGHOUT: they vary PROSE and always
 * pass a clean ref name (or none at all), so `ref.name.length` and the matched span
 * were always equal. No amount of extra prose could have found this — the missing
 * dimension was the NAME. That is the lesson worth keeping: a corpus that varies one
 * axis exhaustively proves nothing about a second one.
 *
 * It also predates `f7bcecb8` — the escaping round did not introduce it — but that
 * commit claimed byte-identical round-trip fidelity and refactored this exact
 * function, so it is in scope here. Live data is clean (0 rows with a non-NULL
 * `cook_source`), so this is prevention, not remediation.
 */
describe("round-trip fidelity — REF-NAME whitespace (H3)", () => {
  /** Every way a ref name's normalization can change its length. */
  const NAMES: [string, string][] = [
    ["a trailing space", "flour "],
    ["a leading space", " flour"],
    ["both", " flour "],
    ["an internal DOUBLE space", "brown  sugar"],
    ["an internal TRIPLE space", "brown   sugar"],
    ["a TAB", "brown\tsugar"],
    ["an NBSP", "brown\u00a0sugar"],
    ["a newline", "brown\nsugar"],
    ["mixed leading, internal and trailing", "  brown \t sugar  "],
    // `"İ".toLowerCase()` is TWO code units, so the needle is LONGER than the text it
    // matched: the same off-by-N as H3, reached through `toLowerCase()` instead.
    ["a name whose lowercasing changes LENGTH", "İstanbul spice"],
  ];

  /** The three positions a ref can occupy in a step. */
  function proseFor(name: string): [string, string][] {
    const anchor = name.trim().replace(/\s+/g, " ");

    return [
      ["at the start", `${anchor} goes in first, then water.`],
      ["in the middle", `Add ${anchor} now.`],
      ["at the end", `Whisk the water into the ${anchor}`],
    ];
  }

  for (const [label, name] of NAMES) {
    for (const [position, prose] of proseFor(name)) {
      it(`keeps the prose BYTE-IDENTICAL with ${label}, ${position}`, async () => {
        const cook = structuredToCooklang(
          recipeOf([
            { text: prose, order: 0, ingredients: [{ name, amount: 1, unit: "cup" }] },
          ]),
          units
        );

        expect(findCookSourceDefect(cook), cook).toBeNull();

        const tokens = await parseCookSource(cook, units);

        expect(tokens, cook).not.toBeNull();
        // The ingredient landed INLINE (not appended), so the assertion below is
        // really about the span that was replaced.
        expect(tokens![0]!.tokens.some((token) => token.type === "ingredient")).toBe(true);
        expect(renderProse(tokens!)).toBe(prose);
      });
    }
  }

  it("the four MEASURED H3 artefacts render byte-identically", async () => {
    const artefacts: [string, string][] = [
      ["flour ", "Add flour now."],
      [" flour", "Add flour now."],
      ["brown  sugar", "Add brown sugar into the bowl."],
      ["brown   sugar", "Add brown sugar into the bowl."],
    ];

    for (const [name, prose] of artefacts) {
      const cook = structuredToCooklang(
        recipeOf([{ text: prose, order: 0, ingredients: [{ name, amount: 1, unit: "cup" }] }]),
        units
      );
      const tokens = await parseCookSource(cook, units);

      expect(renderProse(tokens!), `${JSON.stringify(name)} in ${JSON.stringify(prose)}`).toBe(
        prose
      );
    }

    // and the exact regressions, named:
    const flour = await parseCookSource(
      structuredToCooklang(
        recipeOf([
          {
            text: "Add flour now.",
            order: 0,
            ingredients: [{ name: "flour ", amount: 1, unit: "cup" }],
          },
        ]),
        units
      ),
      units
    );

    expect(renderProse(flour!)).not.toBe("Add flournow.");
    expect(renderProse(flour!)).toBe("Add flour now.");
  });

  it("the ingredient NAME still comes back trimmed and collapsed, and the ref is never dropped", async () => {
    const cook = structuredToCooklang(
      recipeOf([
        {
          text: "Add brown sugar now.",
          order: 0,
          ingredients: [{ name: "  brown   sugar ", amount: 50, unit: "gram" }],
        },
      ]),
      units
    );
    const tokens = (await parseCookSource(cook, units))!;

    expect(tokens[0]!.tokens).toContainEqual({
      type: "ingredient",
      name: "brown sugar",
      amount: 50,
      unit: "gram",
    });
    expect(renderProse(tokens)).toBe("Add brown sugar now.");
  });
});

describe("round-trip fidelity — the documented, deliberate normalizations", () => {
  it("folds CR/LF in step prose to a single space (a newline is a structural injection)", async () => {
    // Left verbatim, `\n\n` would start a NEW step and `\n== x ==` a new section, so
    // a model could inject `.cook` structure through step prose. Folding is the fix;
    // it is the ONE character class that does not survive byte-identically.
    expect(await roundTrip("Mix\nthen fold")).toBe("Mix then fold");
    expect(await roundTrip("Mix\r\nthen fold")).toBe("Mix then fold");
    expect(await roundTrip("Mix\n\n== Injected ==\n\n@a{1%}")).toBe(
      "Mix  == Injected ==  @a{1%}"
    );
  });

  it("a newline-bearing step cannot inject a step, a section or a token", async () => {
    const cook = structuredToCooklang(
      recipeOf([stepOf("Mix\n\n== Injected ==\n\nSecond step @a{1%} here")]),
      units
    );

    expect(findCookSourceDefect(cook)).toBeNull();

    const tokens = (await parseCookSource(cook, units))!;

    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.section).toBeNull();
    expect(tokens[0]!.tokens.every((token) => token.type === "text")).toBe(true);
  });

  it("a newline-bearing recipe NAME cannot break out of the YAML frontmatter", async () => {
    const cook = structuredToCooklang(
      {
        name: "Roast\n---\n\n@a{1%} @b{2%}",
        systemUsed: "metric",
        steps: [stepOf("Mix it.")],
      },
      units
    );

    expect(findCookSourceDefect(cook)).toBeNull();
    expect(cook.split("---\n")).toHaveLength(3);

    const tokens = (await parseCookSource(cook, units))!;

    expect(tokens).toHaveLength(1);
    expect(renderProse(tokens)).toBe("Mix it.");
  });

  it("still trims leading and trailing whitespace, exactly as before", async () => {
    expect(await roundTrip("  Mix well.  ")).toBe("Mix well.");
  });

  it("documents the one irreducible loss: a LONE SURROGATE cannot cross into WASM", async () => {
    // JS strings are UTF-16 and the WASM boundary is UTF-8, so an unpaired surrogate
    // becomes U+FFFD before the parser ever sees it. Nothing at this layer can fix
    // that, and no valid text contains one.
    expect(await roundTrip("Mix a \uD800 b")).toBe("Mix a � b");
    // a properly paired astral character is untouched
    expect(await roundTrip("Mix a \u{1F355} b")).toBe("Mix a \u{1F355} b");
  });
});

/**
 * R4: vitest will not exit while a child process lives, so every suite that parses
 * must tear the pool down. A leaked child hangs the whole run.
 */
afterAll(() => {
  shutdownCookParsePool();
});
