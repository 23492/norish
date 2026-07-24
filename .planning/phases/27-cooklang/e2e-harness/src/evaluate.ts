// SPIKE — Phase 27 (COOK-01). The assertion engine: turns a structured extraction
// into a `.cook`, reparses it with the real WASM parser, and checks that every
// step's ingredients carry the right INLINE per-step amount — plus the D-7
// confidence signals from 27-EXPERIMENT.md.
//
// Every check returns { text, passed, evidence } (the field names the skill-creator
// eval viewer / grading.json expect), so an eval run is directly gradeable.

import { cooklangExtractionSchema, type CooklangExtraction } from "./schema.js";
import { parseCook, type ParsedRecipe } from "./cooklang.js";
import {
  serializeWithReport,
  type SerRecipe,
  type SerStep,
  type LinkOutcome,
} from "./serializer.js";

export type System = "metric" | "us";

export interface Check {
  text: string;
  passed: boolean;
  evidence: string;
}

export interface ExpectedLink {
  step: number; // 0-based index into non-heading steps
  name: string;
  amount: number | string | null;
  unit: string | null;
}

export interface Expectation {
  /** the inline per-step amounts that MUST round-trip exactly */
  inlineAmounts: ExpectedLink[];
  /** ingredients that must appear bare (amount null) — "to taste" / garnish w/o qty */
  toTaste?: string[];
  /** ingredients legitimately named in >1 step; exactly one step must carry the amount */
  multiStep?: string[];
  /** irreducible split-amount ingredients; sum-check is a WARNING, not a failure */
  splitAmount?: string[];
  /** section headings expected in the .cook */
  sections?: string[];
  /** tolerated appended (unanchored) links; default 0 */
  allowAppended?: number;
}

export interface EvalResult {
  system: System;
  cook: string;
  parsed: ParsedRecipe;
  links: LinkOutcome[];
  checks: Check[];
  confidence: "trusted" | "low";
  confidenceReasons: string[];
  passed: number;
  total: number;
}

function num(x: number | string | null | undefined): number | null {
  if (x == null || x === "") return null;
  const n = typeof x === "string" ? Number(x) : x;
  return Number.isFinite(n) ? n : null;
}

// Faithful subset of norish's config-driven `normalizeUnit` (unit-localization.ts):
// map common short/alternate unit forms to the canonical unit ID that the .cook
// carries (D-8). The real pipeline runs this before serializing, so the harness does
// too — otherwise a model emitting "ml"/"g"/"EL" would look wrong when it is fine.
const UNIT_ALIASES: Record<string, string> = {
  g: "gram", gr: "gram", gram: "gram", grams: "gram", grammen: "gram",
  kg: "kilogram", kilo: "kilogram", kilogram: "kilogram",
  mg: "milligram",
  ml: "milliliter", milliliter: "milliliter", milliliters: "milliliter",
  cl: "centiliter", dl: "deciliter",
  l: "liter", liter: "liter", litre: "liter", liters: "liter",
  el: "tablespoon", tbsp: "tablespoon", tablespoon: "tablespoon", tablespoons: "tablespoon", eetlepel: "tablespoon",
  tl: "teaspoon", tsp: "teaspoon", teaspoon: "teaspoon", teaspoons: "teaspoon", theelepel: "teaspoon",
  clove: "clove", cloves: "clove", teen: "clove", teentje: "clove",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  cup: "cup", cups: "cup",
  minute: "minutes", minutes: "minutes", min: "minutes", minuut: "minuten", minuten: "minuten",
};

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (unit == null) return null;
  const key = unit.trim().toLowerCase();
  if (key === "") return null;
  return UNIT_ALIASES[key] ?? unit.trim();
}

/** Adapt the per-step extraction (one system) into the pure serializer's input. */
export function extractionToSerRecipe(extraction: CooklangExtraction, system: System): SerRecipe {
  const instructions = extraction.recipeInstructions[system] ?? [];
  const steps: SerStep[] = instructions.map((s, i) => ({
    text: s.text,
    order: i,
    // mirror the real pipeline: normalize each per-step unit to its canonical ID
    // before the pure serializer emits the `.cook` (D-8).
    ingredients: s.ingredients.map((r) => ({
      name: r.name,
      amount: r.amount,
      unit: normalizeUnit(r.unit),
    })),
    timers: (s.timers ?? []).map((t) => ({
      name: t.name,
      amount: t.amount,
      unit: normalizeUnit(t.unit) ?? t.unit,
    })),
  }));
  const yieldNum = num(extraction.recipeYield as any);
  return {
    name: extraction.name,
    servings: yieldNum,
    source: extraction.source ?? null,
    systemUsed: system,
    steps,
  };
}

function amountsEqual(a: number | string | null, b: number | string | null): boolean {
  const na = num(a);
  const nb = num(b);
  if (na != null || nb != null) return na === nb;
  return (a ?? null) === (b ?? null); // both null, or both same string
}

/** longest common substring length — cheap fuzzy name relatedness. */
function lcsLen(a: string, b: string): number {
  let best = 0;
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
      if (dp[j] > best) best = dp[j];
      prev = tmp;
    }
  }
  return best;
}

/**
 * Are two ingredient names "the same ingredient"? A live model legitimately picks a
 * different surface form than the list line — "ontbijtspek" vs the prose word
 * "spekjes", "wortel" vs plural "wortels", "rundvleesbouillonblokje" vs
 * "bouillonblokje". We assert the LINKAGE PROPERTY (right amount on the right step),
 * not one exact tokenization, so names match on equality / containment / a shared
 * 4+ char substring. Amount + step index stay strict — that is what actually matters.
 */
export function namesRelated(a: string, b: string): boolean {
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;
  return lcsLen(la, lb) >= 4;
}

/** Units match if they normalize equal, OR either side is unspecified (a model may
 *  capture a container word like "klein blikje" where the truth is a bare count). */
function unitCompatible(expected: string | null, got: string | null): boolean {
  const en = normalizeUnit(expected);
  const gn = normalizeUnit(got);
  return en === gn || en == null || gn == null;
}

export function evaluate(
  extraction: CooklangExtraction,
  expectation: Expectation,
  system: System
): EvalResult {
  const checks: Check[] = [];

  // 1. schema validity
  const parseRes = cooklangExtractionSchema.safeParse(extraction);
  checks.push({
    text: "output is valid against the per-step extraction schema",
    passed: parseRes.success,
    evidence: parseRes.success
      ? "zod safeParse succeeded"
      : JSON.stringify(parseRes.error.issues.slice(0, 4)),
  });

  const ser = serializeWithReport(extractionToSerRecipe(extraction, system));
  const cook = ser.cook;

  // 2. .cook reparses into steps
  let parsed: ParsedRecipe = { steps: [], sectionNames: [], warnings: "" };
  let parseOk = false;
  try {
    parsed = parseCook(cook);
    parseOk = parsed.steps.length > 0;
  } catch (err) {
    parseOk = false;
    parsed.warnings = String(err);
  }
  checks.push({
    text: "serialized .cook reparses with the real WASM parser into >=1 step",
    passed: parseOk,
    evidence: parseOk
      ? `${parsed.steps.length} steps parsed`
      : `parse failed: ${parsed.warnings.slice(0, 200)}`,
  });

  // 3. every expected inline per-step amount round-trips exactly.
  // For a KNOWN split-amount ingredient (coconut milk used "a little" then "the
  // rest"), the step the amount lands on is genuinely ambiguous — both "amount on
  // first add" and "amount on main use" are valid — so we assert only that the
  // amount appears once on SOME step and skip the (unrecoverable) bare ref's slot.
  const splitSet = new Set((expectation.splitAmount ?? []).map((s) => s.toLowerCase()));
  const inlineMisses: string[] = [];
  for (const exp of expectation.inlineAmounts) {
    const isSplit = splitSet.has(exp.name.toLowerCase());
    if (isSplit && num(exp.amount) == null) continue; // bare split ref: placement not assertable
    const searchIn = isSplit
      ? parsed.steps.flatMap((s) => s.ingredients)
      : (parsed.steps[exp.step]?.ingredients ?? []);
    const hit = searchIn.find(
      (ing) =>
        namesRelated(ing.name, exp.name) &&
        amountsEqual(ing.amount, exp.amount) &&
        unitCompatible(exp.unit, ing.unit)
    );
    if (!hit) {
      const got = (parsed.steps[exp.step]?.ingredients ?? [])
        .filter((i) => namesRelated(i.name, exp.name))
        .map((i) => `${i.amount ?? "-"}${i.unit ? "%" + i.unit : ""}`)
        .join(",");
      inlineMisses.push(
        `step ${exp.step} ${exp.name}: want ${exp.amount ?? "-"}${exp.unit ? "%" + exp.unit : ""} got [${got || "absent"}]`
      );
    }
  }
  checks.push({
    text: `all ${expectation.inlineAmounts.length} expected inline per-step amounts round-trip exactly`,
    passed: inlineMisses.length === 0,
    evidence: inlineMisses.length === 0 ? "all correct" : inlineMisses.join(" | "),
  });

  // 4. to-taste ingredients render bare (amount null) somewhere
  if (expectation.toTaste?.length) {
    const missing = expectation.toTaste.filter(
      (name) =>
        !parsed.steps.some((s) =>
          s.ingredients.some((i) => namesRelated(i.name, name) && i.amount == null)
        )
    );
    checks.push({
      text: `to-taste ingredients (${expectation.toTaste.join(", ")}) render bare with no amount`,
      passed: missing.length === 0,
      evidence: missing.length === 0 ? "all bare" : `not bare/absent: ${missing.join(", ")}`,
    });
  }

  // 5. multi-step ingredients: exactly one step carries a non-null amount (no double count)
  if (expectation.multiStep?.length) {
    const offenders: string[] = [];
    for (const name of expectation.multiStep) {
      let withAmount = 0;
      for (const s of extraction.recipeInstructions[system]) {
        for (const r of s.ingredients) {
          if (r.name.toLowerCase() === name.toLowerCase() && num(r.amount) != null) withAmount += 1;
        }
      }
      if (withAmount !== 1) offenders.push(`${name} carries amount in ${withAmount} steps`);
    }
    checks.push({
      text: `multi-step ingredients (${expectation.multiStep.join(", ")}) carry their amount in exactly one step`,
      passed: offenders.length === 0,
      evidence: offenders.length === 0 ? "single amount each" : offenders.join("; "),
    });
  }

  // 6. no orphan ingredients: every listed ingredient is referenced by a step
  const listed = extraction.recipeIngredient[system] ?? [];
  const referenced = new Set(
    extraction.recipeInstructions[system].flatMap((s) => s.ingredients.map((r) => r.name.toLowerCase()))
  );
  const orphans = listed.filter((line) => {
    // an ingredient line "400 g chopped tomatoes" is covered if any referenced name
    // appears in the line, or shares a 4+ char run with it (plural / prose-form drift)
    const l = line.toLowerCase();
    return ![...referenced].some((n) => l.includes(n) || lcsLen(l, n) >= 4);
  });
  checks.push({
    text: "every listed ingredient is referenced by at least one step (no orphans)",
    passed: orphans.length === 0,
    evidence: orphans.length === 0 ? "no orphans" : `orphaned lines: ${orphans.join(" | ")}`,
  });

  // 7. sections present
  if (expectation.sections?.length) {
    const missing = expectation.sections.filter((s) => !parsed.sectionNames.includes(s));
    checks.push({
      text: `section headings (${expectation.sections.join(", ")}) present in .cook`,
      passed: missing.length === 0,
      evidence: missing.length === 0 ? "all present" : `missing: ${missing.join(", ")}`,
    });
  }

  // 8. anchoring: appended (unanchored) links within tolerance
  const appended = ser.links.filter((l) => l.placement === "appended");
  const allowAppended = expectation.allowAppended ?? 0;
  checks.push({
    text: `ingredient links anchor inline (appended <= ${allowAppended})`,
    passed: appended.length <= allowAppended,
    evidence:
      appended.length === 0
        ? "0 appended"
        : `${appended.length} appended: ${appended.map((a) => a.ingredient).join(", ")}`,
  });

  // ---- D-7 confidence gate (informational; drives trusted-vs-review routing) ----
  const confidenceReasons: string[] = [];
  if (appended.length > 0) confidenceReasons.push(`${appended.length} appended link(s)`);
  if (orphans.length > 0) confidenceReasons.push(`${orphans.length} orphan ingredient(s)`);
  // sum-check: an ingredient declaring an amount in >1 step overstates the total
  const splitFlagged = expectation.splitAmount ?? [];
  const doubleCounted: string[] = [];
  const amountCounts = new Map<string, number>();
  for (const s of extraction.recipeInstructions[system]) {
    for (const r of s.ingredients) {
      if (num(r.amount) != null) {
        const k = r.name.toLowerCase();
        amountCounts.set(k, (amountCounts.get(k) ?? 0) + 1);
      }
    }
  }
  for (const [name, c] of amountCounts) {
    if (c > 1 && !splitFlagged.map((s) => s.toLowerCase()).includes(name)) {
      doubleCounted.push(`${name} x${c}`);
    }
  }
  if (doubleCounted.length > 0) confidenceReasons.push(`amount declared >1x: ${doubleCounted.join(", ")}`);
  if (splitFlagged.length > 0) confidenceReasons.push(`known split-amount: ${splitFlagged.join(", ")}`);

  const confidence: "trusted" | "low" = confidenceReasons.length === 0 ? "trusted" : "low";

  const passed = checks.filter((c) => c.passed).length;
  return {
    system,
    cook,
    parsed,
    links: ser.links,
    checks,
    confidence,
    confidenceReasons,
    passed,
    total: checks.length,
  };
}
