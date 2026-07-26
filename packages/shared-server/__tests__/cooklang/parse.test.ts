// Phase 27 (COOK-01) W1 — `.cook` -> `cookTokens` read model, against the REAL
// `@cooklang/cooklang` WASM parser (no mock, no stub, no fake).

import { afterAll, describe, expect, it } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { parseCookSource } from "@norish/shared-server/cooklang/parse";
import { CookTokensSchema } from "@norish/shared/contracts/zod";
import { shutdownCookParsePool } from "../../src/cooklang/pool";

const unitsConfig = defaultUnits as UnitsMap;

// Hand-written in the shape `structuredToCooklang` emits, which since W3B
// (D-27-W3B-06 — H1) QUOTES every non-numeric metadata value: the recognizer accepts
// a quoted scalar or a plain number and nothing else, so `title: Chocolate Chip
// Cookies` unquoted is no longer serializer output and `parseCookSource` refuses it.
const COOK = [
  "---",
  'title: "Chocolate Chip Cookies"',
  "servings: 24",
  'norish.system: "metric"',
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
  it("dereferences ingredient indices into name + amount + canonical unit", async () => {
    const tokens = await parseCookSource(COOK, unitsConfig);

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

  it("keeps amount-less and unit-less ingredients as nulls", async () => {
    const tokens = (await parseCookSource(COOK, unitsConfig))!;
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

  it("carries `== Heading ==` section names onto every step of that section", async () => {
    const tokens = (await parseCookSource(COOK, unitsConfig))!;

    expect(tokens.map((step) => step.section)).toEqual(["Dough", "Dough", "Bake"]);
    expect(tokens.map((step) => step.order)).toEqual([0, 1, 2]);
  });

  it("projects timers, and keeps cookware readable as prose", async () => {
    const tokens = (await parseCookSource(COOK, unitsConfig))!;
    const bake = tokens[2]!;

    expect(bake.tokens).toContainEqual({
      type: "timer",
      name: null,
      amount: 12,
      unit: "minutes",
    });
    expect(bake.tokens.map((t) => (t.type === "text" ? t.value : "")).join("")).toContain("oven");
  });

  it("normalizes a raw `%unit` back to its canonical norish unit ID (D-8)", async () => {
    const tokens = (await parseCookSource("Mix @flour{200%gr} with @oil{2%EL}.\n", unitsConfig))!;
    const units = tokens[0]!.tokens.flatMap((t) => (t.type === "ingredient" ? [t.unit] : []));

    expect(units).toEqual(["gram", "tablespoon"]);
  });

  it("is identity-behaved on units when no units config is supplied", async () => {
    const tokens = (await parseCookSource("Mix @flour{200%gr}.\n"))!;

    expect(tokens[0]!.tokens).toContainEqual({
      type: "ingredient",
      name: "flour",
      amount: 200,
      unit: "gr",
    });
  });
});

describe("parseCookSource — the output is plain JSON that validates against the contract", () => {
  it("carries NO raw parser index and survives structuredClone", async () => {
    const tokens = (await parseCookSource(COOK, unitsConfig))!;
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

  it("validates against the CookTokens zod contract (the seam that would silently drift)", async () => {
    const tokens = await parseCookSource(COOK, unitsConfig);

    expect(() => CookTokensSchema.parse(tokens)).not.toThrow();
    expect(CookTokensSchema.parse(tokens)).toEqual(tokens);
  });
});

describe("parseCookSource — failure mode is part of the contract", () => {
  it("returns null and NEVER throws on empty, garbage or non-string input", async () => {
    await expect(parseCookSource("")).resolves.toBeNull();

    await expect(parseCookSource("   \n  ")).resolves.toBeNull();

    await expect(parseCookSource("@@@{{{")).resolves.toBeNull();

    await expect(parseCookSource("~{bad")).resolves.toBeNull();

    await expect(parseCookSource(null as never)).resolves.toBeNull();

    await expect(parseCookSource(undefined as never)).resolves.toBeNull();

    await expect(parseCookSource(42 as never)).resolves.toBeNull();
  });

  it("returns null for a source that parses but yields no steps", async () => {
    expect(await parseCookSource("---\ntitle: Nothing\n---\n")).toBeNull();
  });

  it("returns null when the parser emits a diagnostic (untrustworthy read model)", async () => {
    // `servings` is typed as a number by Cooklang; a quoted value warns.
    expect(await parseCookSource('---\nservings: "4"\n---\nMix @flour{1%gram}.\n')).toBeNull();
  });
});

describe("parseCookSource — parser reuse", () => {
  it("returns identical output across calls (module-level parser singleton)", async () => {
    const first = await parseCookSource(COOK, unitsConfig);
    const second = await parseCookSource(COOK, unitsConfig);

    expect(second).toEqual(first);
  });
});

/**
 * R4: vitest will not exit while a child process lives, so every suite that parses
 * must tear the pool down. A leaked child hangs the whole run.
 */
afterAll(() => {
  shutdownCookParsePool();
});
