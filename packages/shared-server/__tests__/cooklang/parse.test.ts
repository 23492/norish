// Phase 27 (COOK-01) W1 — `.cook` -> `cookTokens` read model, against the REAL
// `@cooklang/cooklang` WASM parser (no mock, no stub, no fake).

import { describe, expect, it } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { parseCookSource } from "@norish/shared-server/cooklang/parse";
import { CookTokensSchema } from "@norish/shared/contracts/zod";

const unitsConfig = defaultUnits as UnitsMap;

const COOK = [
  "---",
  "title: Chocolate Chip Cookies",
  "servings: 24",
  "norish.system: metric",
  "---",
  "== Dough ==",
  "",
  "Cream the @butter{115%gram} with the @brown sugar{150%gram} until fluffy.",
  "",
  "Beat in the @egg{1} and @salt.",
  "",
  "== Bake ==",
  "",
  "Bake in the #oven{} for ~{12%minutes} until golden.",
  "",
].join("\n");

describe("parseCookSource — happy path", () => {
  it("dereferences ingredient indices into name + amount + canonical unit", () => {
    const tokens = parseCookSource(COOK, unitsConfig);

    expect(tokens).not.toBeNull();

    const first = tokens![0]!;

    expect(first.order).toBe(0);
    expect(first.section).toBe("Dough");
    expect(first.tokens).toEqual([
      { type: "text", value: "Cream the " },
      { type: "ingredient", name: "butter", amount: 115, unit: "gram" },
      { type: "text", value: " with the " },
      { type: "ingredient", name: "brown sugar", amount: 150, unit: "gram" },
      { type: "text", value: " until fluffy." },
    ]);
  });

  it("keeps amount-less and unit-less ingredients as nulls", () => {
    const tokens = parseCookSource(COOK, unitsConfig)!;
    const second = tokens[1]!;

    expect(second.tokens).toContainEqual({
      type: "ingredient",
      name: "egg",
      amount: 1,
      unit: null,
    });
    expect(second.tokens).toContainEqual({
      type: "ingredient",
      name: "salt",
      amount: null,
      unit: null,
    });
  });

  it("carries `== Heading ==` section names onto every step of that section", () => {
    const tokens = parseCookSource(COOK, unitsConfig)!;

    expect(tokens.map((step) => step.section)).toEqual(["Dough", "Dough", "Bake"]);
    expect(tokens.map((step) => step.order)).toEqual([0, 1, 2]);
  });

  it("projects timers, and keeps cookware readable as prose", () => {
    const tokens = parseCookSource(COOK, unitsConfig)!;
    const bake = tokens[2]!;

    expect(bake.tokens).toContainEqual({
      type: "timer",
      name: null,
      amount: 12,
      unit: "minutes",
    });
    expect(bake.tokens.map((t) => (t.type === "text" ? t.value : "")).join("")).toContain("oven");
  });

  it("normalizes a raw `%unit` back to its canonical norish unit ID (D-8)", () => {
    const tokens = parseCookSource("Mix @flour{200%gr} with @oil{2%EL}.\n", unitsConfig)!;
    const units = tokens[0]!.tokens.flatMap((t) => (t.type === "ingredient" ? [t.unit] : []));

    expect(units).toEqual(["gram", "tablespoon"]);
  });

  it("is identity-behaved on units when no units config is supplied", () => {
    const tokens = parseCookSource("Mix @flour{200%gr}.\n")!;

    expect(tokens[0]!.tokens).toContainEqual({
      type: "ingredient",
      name: "flour",
      amount: 200,
      unit: "gr",
    });
  });
});

describe("parseCookSource — the output is plain JSON that validates against the contract", () => {
  it("carries NO raw parser index and survives structuredClone", () => {
    const tokens = parseCookSource(COOK, unitsConfig)!;
    const serialized = JSON.stringify(tokens);

    expect(serialized).not.toContain('"index"');
    expect(() => structuredClone(tokens)).not.toThrow();
    expect(JSON.parse(serialized)).toEqual(tokens);

    for (const step of tokens) {
      expect(Object.getPrototypeOf(step)).toBe(Object.prototype);

      for (const token of step.tokens) {
        expect(Object.getPrototypeOf(token)).toBe(Object.prototype);
      }
    }
  });

  it("validates against the CookTokens zod contract (the seam that would silently drift)", () => {
    const tokens = parseCookSource(COOK, unitsConfig);

    expect(() => CookTokensSchema.parse(tokens)).not.toThrow();
    expect(CookTokensSchema.parse(tokens)).toEqual(tokens);
  });
});

describe("parseCookSource — failure mode is part of the contract", () => {
  it("returns null and NEVER throws on empty, garbage or non-string input", () => {
    expect(() => parseCookSource("")).not.toThrow();
    expect(parseCookSource("")).toBeNull();

    expect(() => parseCookSource("   \n  ")).not.toThrow();
    expect(parseCookSource("   \n  ")).toBeNull();

    expect(() => parseCookSource("@@@{{{")).not.toThrow();
    expect(parseCookSource("@@@{{{")).toBeNull();

    expect(() => parseCookSource("~{bad")).not.toThrow();
    expect(parseCookSource("~{bad")).toBeNull();

    expect(() => parseCookSource(null as never)).not.toThrow();
    expect(parseCookSource(null as never)).toBeNull();

    expect(() => parseCookSource(undefined as never)).not.toThrow();
    expect(parseCookSource(undefined as never)).toBeNull();

    expect(() => parseCookSource(42 as never)).not.toThrow();
    expect(parseCookSource(42 as never)).toBeNull();
  });

  it("returns null for a source that parses but yields no steps", () => {
    expect(parseCookSource("---\ntitle: Nothing\n---\n")).toBeNull();
  });

  it("returns null when the parser emits a diagnostic (untrustworthy read model)", () => {
    // `servings` is typed as a number by Cooklang; a quoted value warns.
    expect(parseCookSource('---\nservings: "4"\n---\nMix @flour{1%gram}.\n')).toBeNull();
  });
});

describe("parseCookSource — parser reuse", () => {
  it("returns identical output across calls (module-level parser singleton)", () => {
    const first = parseCookSource(COOK, unitsConfig);
    const second = parseCookSource(COOK, unitsConfig);

    expect(second).toEqual(first);
  });
});
