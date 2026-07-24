// SPIKE — Phase 27 (COOK-01). Parse a `.cook` string back into a plain structure
// using the REAL `@cooklang/cooklang@0.18.7` WASM parser, so the harness can assert
// that every step's ingredients round-tripped with the right INLINE per-step amount.
//
// IMPORTANT: parse WITHOUT a scale argument. `parse(src)` preserves canonical unit
// IDs verbatim (`gram`, `tablespoon` — D-8); `parse(src, 1)` normalizes them
// (`gram`→`g`), which would defeat the round-trip check. Verified this session.
//
// Requires node flag `--experimental-wasm-modules` (set via NODE_OPTIONS in the npm
// scripts) because the package imports its `.wasm` as an ESM module.

import { CooklangParser, getQuantityValue, getQuantityUnit } from "@cooklang/cooklang";

export interface ParsedIngredient {
  name: string;
  amount: number | string | null;
  unit: string | null;
}
export interface ParsedTimer {
  name: string | null;
  amount: number | string | null;
  unit: string | null;
}
export interface ParsedStep {
  sectionName: string | null;
  text: string;
  ingredients: ParsedIngredient[];
  timers: ParsedTimer[];
}
export interface ParsedRecipe {
  steps: ParsedStep[];
  sectionNames: string[];
  warnings: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function quantityToAmountUnit(quantity: any): { amount: number | string | null; unit: string | null } {
  if (!quantity) return { amount: null, unit: null };
  const amount = getQuantityValue(quantity);
  const unit = getQuantityUnit(quantity);
  return {
    amount: amount == null ? null : amount,
    unit: unit == null || unit === "" ? null : unit,
  };
}

export function parseCook(cook: string): ParsedRecipe {
  const parser = new CooklangParser();
  const [recipe, report] = parser.parse(cook) as [any, string];

  const ingredients = recipe.ingredients ?? [];
  const timers = recipe.timers ?? [];
  const steps: ParsedStep[] = [];
  const sectionNames: string[] = [];

  for (const section of recipe.sections ?? []) {
    if (section.name) sectionNames.push(section.name);
    for (const content of section.content ?? []) {
      if (content.type !== "step") continue;
      const step = content.value;
      const stepIngredients: ParsedIngredient[] = [];
      const stepTimers: ParsedTimer[] = [];
      let text = "";

      for (const item of step.items ?? []) {
        if (item.type === "text") {
          text += item.value;
        } else if (item.type === "ingredient") {
          const ing = ingredients[item.index];
          if (ing) {
            const { amount, unit } = quantityToAmountUnit(ing.quantity);
            stepIngredients.push({ name: ing.name, amount, unit });
            text += ing.name;
          }
        } else if (item.type === "timer") {
          const t = timers[item.index];
          if (t) {
            const { amount, unit } = quantityToAmountUnit(t.quantity);
            stepTimers.push({ name: t.name ?? null, amount, unit });
          }
        } else if (item.type === "cookware") {
          // not used by norish steps yet; ignore for round-trip
        }
      }

      steps.push({
        sectionName: section.name ?? null,
        text: text.trim(),
        ingredients: stepIngredients,
        timers: stepTimers,
      });
    }
  }

  return { steps, sectionNames, warnings: report ?? "" };
}
