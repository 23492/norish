// SPIKE — Phase 27 (COOK-01) round-trip tests.
// Validates the prototype serializer against the REAL installed WASM parser
// `@cooklang/cooklang@0.18.7` (confirmed present in this spike's node_modules).
// Proves: structured -> .cook -> parse -> the SAME per-step ingredient amounts.

import { describe, expect, it } from "vitest";
import {
  CooklangParser,
  getQuantityValue,
  getQuantityUnit,
  type CooklangRecipe,
} from "@cooklang/cooklang";

import { fixtures } from "./fixtures";
import { serializeWithReport, structuredToCooklang } from "./structured-to-cooklang";

type ParsedStep = { text: string; ingredients: { name: string; amount: number | null; unit: string | null }[] };

/** Walk parser output into per-step inline ingredients, dereferencing indices. */
function extractSteps(recipe: CooklangRecipe): ParsedStep[] {
  const steps: ParsedStep[] = [];
  for (const section of recipe.sections) {
    for (const content of section.content as any[]) {
      if (content.type !== "step") continue;
      const step = content.value ?? content.step ?? content;
      const items: any[] = step.items ?? [];
      let text = "";
      const ingredients: ParsedStep["ingredients"] = [];
      for (const item of items) {
        if (item.type === "text") text += item.value;
        else if (item.type === "ingredient") {
          const ing = recipe.ingredients[item.index];
          text += ing.name;
          ingredients.push({
            name: ing.name,
            amount: getQuantityValue(ing.quantity),
            unit: getQuantityUnit(ing.quantity),
          });
        }
      }
      steps.push({ text, ingredients });
    }
  }
  return steps;
}

function parse(cook: string): CooklangRecipe {
  const parser = new CooklangParser();
  const [recipe] = parser.parse(cook);
  return recipe;
}

describe("structuredToCooklang — parses cleanly under the real WASM parser", () => {
  for (const fx of fixtures) {
    it(`${fx.slug}: emits valid .cook that the parser accepts`, () => {
      const cook = structuredToCooklang(fx.recipe);
      const recipe = parse(cook);
      // sanity: at least the non-heading steps survive
      const parsedSteps = extractSteps(recipe);
      const expectedNonHeading = fx.expected.length;
      expect(parsedSteps.length).toBe(expectedNonHeading);
    });
  }
});

describe("round-trip: per-step ingredient amounts survive structured -> .cook -> parse", () => {
  for (const fx of fixtures) {
    it(`${fx.slug}`, () => {
      const cook = structuredToCooklang(fx.recipe);
      const parsedSteps = extractSteps(parse(cook));

      fx.expected.forEach((exp, i) => {
        const got = parsedSteps[i];
        expect(got, `step ${i} present`).toBeDefined();
        // check that the right step lines up
        expect(got.text.includes(exp.stepText)).toBe(true);
        // every expected ingredient appears inline with the right amount + unit
        for (const wantIng of exp.ingredients) {
          const match = got.ingredients.find(
            (g) => g.name.toLowerCase() === wantIng.name.toLowerCase()
          );
          expect(match, `${fx.slug} step ${i}: ${wantIng.name} inline`).toBeDefined();
          expect(match!.amount).toBe(wantIng.amount);
          // D-8: canonical unit ID survives verbatim as the opaque %unit literal
          expect(match!.unit).toBe(wantIng.unit);
        }
      });
    });
  }
});

describe("headings map to sections; timers round-trip", () => {
  it("cookies: `#`-prefixed steps become == sections ==", () => {
    const cook = structuredToCooklang(fixtures.find((f) => f.slug === "cookies")!.recipe);
    expect(cook).toContain("== Dough ==");
    expect(cook).toContain("== Bake ==");
    const recipe = parse(cook);
    expect(recipe.sections.map((s) => s.name)).toContain("Dough");
    expect(recipe.sections.map((s) => s.name)).toContain("Bake");
  });

  it("bolognese: 30-minute timer parses to a timer token", () => {
    const cook = structuredToCooklang(fixtures.find((f) => f.slug === "bolognese")!.recipe);
    const recipe = parse(cook);
    const found = recipe.timers.some((t) => getQuantityValue(t.quantity as any) === 30);
    expect(found).toBe(true);
  });
});

describe("D-8 unit vocabulary: canonical IDs are the %unit literal", () => {
  it("gram/milliliter/tablespoon survive as-is (no conversion)", () => {
    const cook = structuredToCooklang(fixtures.find((f) => f.slug === "bolognese")!.recipe);
    expect(cook).toContain("%gram}");
    expect(cook).toContain("%tablespoon}");
    const recipe = parse(cook);
    const beef = recipe.ingredients.find((i) => i.name === "minced beef");
    expect(getQuantityUnit(beef!.quantity)).toBe("gram");
  });
});

describe("failure-mode surfacing: appended vs inline link report", () => {
  it("every ingredient ref is accounted for as inline or appended", () => {
    for (const fx of fixtures) {
      const { links } = serializeWithReport(fx.recipe);
      const refCount = fx.recipe.steps.reduce((n, s) => n + s.ingredients.length, 0);
      expect(links.length).toBe(refCount);
    }
  });

  it("all fixture refs resolve inline in this hand-linked set (0 appended)", () => {
    // Because the hand-linking anchored every ref to a word present in the prose,
    // NONE fall through to `appended`. Real AI output will not be this clean — the
    // `appended` bucket is the confidence-gate signal (see 27-EXPERIMENT.md).
    for (const fx of fixtures) {
      const { links } = serializeWithReport(fx.recipe);
      const appended = links.filter((l) => l.placement === "appended");
      expect(appended, `${fx.slug} appended: ${appended.map((a) => a.ingredient)}`).toHaveLength(0);
    }
  });
});
