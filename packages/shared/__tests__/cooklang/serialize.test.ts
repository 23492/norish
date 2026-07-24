// Phase 27 (COOK-01) W1 — PURE serializer tests.
// No parser and no WASM in this package: `@norish/shared` is bundled by
// `apps/mobile` and its vitest environment is jsdom (D-27-W1-02). The
// structured -> .cook -> REAL WASM parser round-trip lives in
// `@norish/shared-server/__tests__/cooklang/round-trip.test.ts`.

import { describe, expect, it } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { StructuredRecipe } from "@norish/shared/cooklang";
import defaultUnits from "@norish/config/units.default.json";
import { serializeWithReport, structuredToCooklang } from "@norish/shared/cooklang";

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
    expect(cook).toContain("title: Spaghetti Bolognese");
    expect(cook).toContain('servings: "4"');
    expect(cook).toContain("norish.system: metric");
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
