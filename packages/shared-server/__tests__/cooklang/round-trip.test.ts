// Phase 27 (COOK-01) W1 — THE test that justifies the wave.
//
// structured recipe -> `.cook` (the REAL `@norish/shared/cooklang` serializer,
// on the REAL `normalizeUnit`) -> the REAL `@cooklang/cooklang` WASM parser ->
// the SAME per-step ingredient names, amounts and canonical units.
//
// It lives in `@norish/shared-server` (D-27-W1-02) because this package has BOTH
// halves — it depends on `@norish/shared` and owns the `@cooklang/cooklang`
// dependency — and because its vitest environment is `node`. No mock, no stub,
// no fake: `CooklangParser` here is the real WASM parser.
//
// Ported from `.planning/phases/27-cooklang/spike/structured-to-cooklang.test.ts`
// with every assertion intact; the known irreducibly-lossy cases are asserted at
// their DOCUMENTED behaviour (see `27-EXPERIMENT.md`), never relaxed.
import type { CooklangRecipe } from "@cooklang/cooklang";
import { CooklangParser, getQuantityUnit, getQuantityValue } from "@cooklang/cooklang";
import { describe, expect, it } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { parseCookSource } from "@norish/shared-server/cooklang/parse";
import { serializeWithReport, structuredToCooklang } from "@norish/shared/cooklang";
import { formatUnit } from "@norish/shared/lib/unit-localization";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";

const unitsConfig = defaultUnits as UnitsMap;

type ParsedStep = {
  text: string;
  ingredients: { name: string; amount: number | null; unit: string | null }[];
};

function parse(cook: string): { recipe: CooklangRecipe; report: string } {
  const [recipe, report] = new CooklangParser().parse(cook);

  return { recipe, report };
}

/** Walk parser output into per-step inline ingredients, dereferencing indices. */
function extractSteps(recipe: CooklangRecipe): ParsedStep[] {
  const steps: ParsedStep[] = [];

  for (const section of recipe.sections) {
    for (const content of section.content) {
      if (content.type !== "step") continue;

      let text = "";
      const ingredients: ParsedStep["ingredients"] = [];

      for (const item of content.value.items) {
        if (item.type === "text") {
          text += item.value;
        } else if (item.type === "ingredient") {
          const ingredient = recipe.ingredients[item.index]!;

          text += ingredient.name;
          ingredients.push({
            name: ingredient.name,
            amount: getQuantityValue(ingredient.quantity),
            unit: getQuantityUnit(ingredient.quantity),
          });
        }
      }

      steps.push({ text, ingredients });
    }
  }

  return steps;
}

function cookOf(slug: string): string {
  const fixture = fixtures.find((f) => f.slug === slug);

  if (!fixture) throw new Error(`unknown fixture: ${slug}`);

  return structuredToCooklang(fixture.recipe, unitsConfig);
}

describe("structuredToCooklang output parses cleanly under the REAL WASM parser", () => {
  for (const fixture of fixtures) {
    it(`${fixture.slug}: emits valid .cook that the parser accepts`, () => {
      const { recipe, report } = parse(structuredToCooklang(fixture.recipe, unitsConfig));

      // no diagnostic at all: our own writer must produce a source the parser
      // fully understands, otherwise `parseCookSource` refuses to build a model.
      expect(report, `${fixture.slug} parser report`).toBe("");
      // blank-line separation actually working: the non-heading steps survive
      expect(extractSteps(recipe)).toHaveLength(fixture.expected.length);
    });
  }
});

describe("round-trip: per-step ingredient amounts survive structured -> .cook -> parse", () => {
  for (const fixture of fixtures) {
    it(`${fixture.slug}`, () => {
      const parsedSteps = extractSteps(
        parse(structuredToCooklang(fixture.recipe, unitsConfig)).recipe
      );

      fixture.expected.forEach((expected, index) => {
        const got = parsedSteps[index];

        expect(got, `step ${index} present`).toBeDefined();
        expect(got!.text.includes(expected.stepText)).toBe(true);

        for (const want of expected.ingredients) {
          const match = got!.ingredients.find(
            (candidate) => candidate.name.toLowerCase() === want.name.toLowerCase()
          );

          expect(match, `${fixture.slug} step ${index}: ${want.name} inline`).toBeDefined();
          expect(match!.amount).toBe(want.amount);
          // D-8: the canonical unit ID survives verbatim as the opaque %unit literal
          expect(match!.unit).toBe(want.unit);
        }
      });
    });
  }
});

describe("D-8 unit vocabulary: canonical IDs are the %unit literal", () => {
  it("gram/milliliter/tablespoon survive as-is (no localization, no pluralization, no conversion)", () => {
    const cook = cookOf("bolognese");

    expect(cook).toContain("%gram}");
    expect(cook).toContain("%tablespoon}");
    expect(cook).not.toContain("%g}");
    expect(cook).not.toContain("%grams}");

    const { recipe } = parse(cook);
    const beef = recipe.ingredients.find((ingredient) => ingredient.name === "minced beef");

    expect(getQuantityUnit(beef!.quantity)).toBe("gram");
    expect(getQuantityValue(beef!.quantity)).toBe(500);
  });

  it("no localized unit label ever entered the .cook", () => {
    for (const fixture of fixtures) {
      const cook = structuredToCooklang(fixture.recipe, unitsConfig);

      for (const localized of ["%g}", "%grams}", "%tbsp}", "%EL}", "%el}", "%tl}", "%ml}"]) {
        expect(cook, `${fixture.slug} contains ${localized}`).not.toContain(localized);
      }
    }
  });
});

describe("read side: formatUnit localizes the parsed canonical unit (D-27-W1-03)", () => {
  it("renders `gram` per locale from the parser's own output", () => {
    const { recipe } = parse(cookOf("bolognese"));
    const beef = recipe.ingredients.find((ingredient) => ingredient.name === "minced beef")!;
    const unit = getQuantityUnit(beef.quantity)!;
    const amount = getQuantityValue(beef.quantity);

    expect(unit).toBe("gram");
    expect(formatUnit(unit, "en", unitsConfig, amount)).toBe("grams");
    expect(formatUnit(unit, "nl", unitsConfig, amount)).toBe("gram");
    expect(formatUnit(unit, "de", unitsConfig, amount)).toBe("g");
  });

  it("renders `tablespoon` per locale from the parser's own output", () => {
    const { recipe } = parse(cookOf("bolognese"));
    const oil = recipe.ingredients.find((ingredient) => ingredient.name === "olive oil")!;
    const unit = getQuantityUnit(oil.quantity)!;

    expect(unit).toBe("tablespoon");
    expect(formatUnit(unit, "en", unitsConfig, 1)).toBe("tbsp");
    expect(formatUnit(unit, "de", unitsConfig, 1)).toBe("EL");
    expect(formatUnit(unit, "nl", unitsConfig, 2)).toBe("eetlepels");
  });
});

describe("headings map to sections; timers round-trip", () => {
  it("cookies: `#`-prefixed steps become == sections ==", () => {
    const cook = cookOf("cookies");

    expect(cook).toContain("== Dough ==");
    expect(cook).toContain("== Bake ==");

    const { recipe } = parse(cook);

    expect(recipe.sections.map((section) => section.name)).toContain("Dough");
    expect(recipe.sections.map((section) => section.name)).toContain("Bake");
    // a heading is a section, NOT a prose step
    expect(extractSteps(recipe).some((step) => step.text.includes("Dough"))).toBe(false);
  });

  it("bolognese: the 30-minute timer parses to a timer token", () => {
    const { recipe } = parse(cookOf("bolognese"));

    expect(recipe.timers.some((timer) => getQuantityValue(timer.quantity) === 30)).toBe(true);
    expect(recipe.timers.some((timer) => getQuantityUnit(timer.quantity) === "minutes")).toBe(true);
  });

  it("every fixture timer survives the round trip", () => {
    for (const fixture of fixtures) {
      const expectedTimers = fixture.recipe.steps.flatMap((step) => step.timers ?? []);
      const { recipe } = parse(structuredToCooklang(fixture.recipe, unitsConfig));

      expect(recipe.timers, fixture.slug).toHaveLength(expectedTimers.length);

      for (const timer of expectedTimers) {
        expect(
          recipe.timers.some(
            (parsed) =>
              getQuantityValue(parsed.quantity) === Number(timer.amount) &&
              getQuantityUnit(parsed.quantity) === timer.unit
          ),
          `${fixture.slug} timer ${timer.amount} ${timer.unit}`
        ).toBe(true);
      }
    }
  });
});

describe("failure-mode surfacing: appended vs inline link report", () => {
  it("every ingredient ref is accounted for as inline or appended", () => {
    for (const fixture of fixtures) {
      const { links } = serializeWithReport(fixture.recipe, unitsConfig);
      const refCount = fixture.recipe.steps.reduce((n, step) => n + step.ingredients.length, 0);

      expect(links, fixture.slug).toHaveLength(refCount);
    }
  });

  it("all fixture refs resolve inline in this hand-linked set (0 appended)", () => {
    // The hand-linking anchored every ref to a word present in the prose, so NONE
    // fall through to `appended`. Real extraction output will not be this clean —
    // the `appended` bucket is W5's confidence-gate signal (27-EXPERIMENT.md).
    for (const fixture of fixtures) {
      const { links } = serializeWithReport(fixture.recipe, unitsConfig);
      const appended = links.filter((link) => link.placement === "appended");

      expect(
        appended,
        `${fixture.slug}: ${appended.map((a) => a.ingredient).join(", ")}`
      ).toHaveLength(0);
    }
  });

  it("an unanchored ref is APPENDED and reported, never silently dropped", () => {
    const { cook, links } = serializeWithReport(
      {
        name: "Garnished bolognese",
        systemUsed: "metric",
        steps: [
          {
            text: "Serve immediately.",
            order: 0,
            ingredients: [{ name: "parmesan", amount: 50, unit: "gram" }],
          },
        ],
      },
      unitsConfig
    );

    expect(links).toEqual([{ stepOrder: 0, ingredient: "parmesan", placement: "appended" }]);

    const parsed = extractSteps(parse(cook).recipe);

    expect(parsed[0]!.ingredients).toEqual([{ name: "parmesan", amount: 50, unit: "gram" }]);
  });
});

describe("documented lossy cases (27-EXPERIMENT.md) — asserted, not relaxed", () => {
  it("curry: a SPLIT amount keeps the total on the main use and a bare token on the note use", () => {
    // coconut milk is 400 ml in total and is used twice. The whole amount is
    // attached to the SECOND (main) use; the first use carries an amount-less
    // token. Cooklang cannot express "a little of the 400 ml", so this is the
    // documented, irreducible loss — not a serializer bug.
    const parsedSteps = extractSteps(parse(cookOf("curry")).recipe);
    const noteUse = parsedSteps[0]!.ingredients.find((i) => i.name === "coconut milk")!;
    const mainUse = parsedSteps[1]!.ingredients.find((i) => i.name === "coconut milk")!;

    expect(noteUse.amount).toBeNull();
    expect(noteUse.unit).toBeNull();
    expect(mainUse.amount).toBe(400);
    expect(mainUse.unit).toBe("milliliter");
  });

  it("cookies: the timer is appended because '12 minutes' is prose, not a token", () => {
    // The serializer cannot rewrite prose into a timer token, so it appends one
    // and leaves the sentence intact. Documented in 27-EXPERIMENT.md.
    const cook = cookOf("cookies");

    expect(cook).toContain("Bake at 180 for 12 minutes until golden at the edges. ~{12%minutes}");
  });
});

describe("the two halves agree: serializer output through parseCookSource", () => {
  for (const fixture of fixtures) {
    it(`${fixture.slug}: cookTokens carry the same per-step amounts`, () => {
      const tokens = parseCookSource(
        structuredToCooklang(fixture.recipe, unitsConfig),
        unitsConfig
      );

      expect(tokens, `${fixture.slug} produced a read model`).not.toBeNull();
      expect(tokens).toHaveLength(fixture.expected.length);

      fixture.expected.forEach((expected, index) => {
        const step = tokens![index]!;

        for (const want of expected.ingredients) {
          expect(step.tokens, `${fixture.slug} step ${index}: ${want.name}`).toContainEqual({
            type: "ingredient",
            name: want.name,
            amount: want.amount,
            unit: want.unit,
          });
        }
      });
    });
  }
});
