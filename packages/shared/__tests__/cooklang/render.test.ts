// Phase 27 (COOK-01) W4 — the pure token RENDER model.
//
// This module is the read-side twin of the W1 serializer: `cookTokens` DTO
// in, ordered/numbered/section-aware/servings-scaled render steps out.
// Nothing here parses `.cook` or touches `@cooklang/cooklang` (T-27-01) —
// only the already-bounded, plain-JSON token payload.

import { describe, expect, it } from "vitest";

import type { CookTokensDTO } from "@norish/shared/contracts/dto/recipe";
import {
  type CookRenderIngredientToken,
  type CookRenderTimerToken,
  cookStepTimers,
  cookStepToMarkdown,
  cookTimerDurationMs,
  resolveCookRenderSteps,
} from "@norish/shared/cooklang";

/**
 * Minimal CommonMark-ish inline-link scanner: honors backslash-escapes in
 * the label (a `\]` does not close it) and balanced parens in the href.
 * Good enough to prove a hostile label cannot forge a SECOND link, without
 * pulling a full markdown parser into this pure package's test suite.
 */
function findMarkdownLinks(markdown: string): Array<{ label: string; href: string }> {
  const links: Array<{ label: string; href: string }> = [];
  let i = 0;

  while (i < markdown.length) {
    if (markdown[i] !== "[") {
      i += 1;
      continue;
    }

    let j = i + 1;
    let label = "";
    let closed = false;

    while (j < markdown.length) {
      if (markdown[j] === "\\" && j + 1 < markdown.length) {
        label += markdown[j] + markdown[j + 1];
        j += 2;
        continue;
      }
      if (markdown[j] === "]") {
        closed = true;
        break;
      }
      label += markdown[j];
      j += 1;
    }

    if (!closed || markdown[j + 1] !== "(") {
      i += 1;
      continue;
    }

    let k = j + 2;
    let depth = 1;
    let href = "";

    while (k < markdown.length && depth > 0) {
      if (markdown[k] === "(") depth += 1;
      if (markdown[k] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      href += markdown[k];
      k += 1;
    }

    if (depth === 0) {
      links.push({ label, href });
      i = k + 1;
    } else {
      i += 1;
    }
  }

  return links;
}

const format = {
  ingredientAmountLabel: (token: CookRenderIngredientToken) =>
    token.amount != null && token.unit != null ? `${token.amount} ${token.unit}` : "",
  timerLabel: (timer: CookRenderTimerToken) => timer.name ?? `${timer.amount} ${timer.unit}`,
};

function tokens(...steps: CookTokensDTO): CookTokensDTO {
  return steps;
}

describe("resolveCookRenderSteps — the null/empty guard", () => {
  it("returns null for null, undefined and an empty array", () => {
    expect(resolveCookRenderSteps(null)).toBeNull();
    expect(resolveCookRenderSteps(undefined)).toBeNull();
    expect(resolveCookRenderSteps([])).toBeNull();
  });
});

describe("resolveCookRenderSteps — ordering and step numbering", () => {
  it("sorts by `order` and assigns 1-based `stepNumber` by sorted position", () => {
    const steps = resolveCookRenderSteps(
      tokens(
        { order: 2, section: null, tokens: [{ type: "text", value: "third" }] },
        { order: 0, section: null, tokens: [{ type: "text", value: "first" }] },
        { order: 1, section: null, tokens: [{ type: "text", value: "second" }] }
      )
    );

    expect(steps).not.toBeNull();
    expect(steps?.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(steps?.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
    expect(steps?.map((s) => (s.tokens[0]?.type === "text" ? s.tokens[0].value : null))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("resolveCookRenderSteps — isSectionStart boundaries", () => {
  it("is true on the first step when it HAS a section", () => {
    const steps = resolveCookRenderSteps(
      tokens({ order: 0, section: "Dough", tokens: [] })
    );

    expect(steps?.[0]?.isSectionStart).toBe(true);
  });

  it("is false on the first step when it has NO section", () => {
    const steps = resolveCookRenderSteps(tokens({ order: 0, section: null, tokens: [] }));

    expect(steps?.[0]?.isSectionStart).toBe(false);
  });

  it("is true again when a section changes, false for a repeated section, and false returning to anonymous", () => {
    const steps = resolveCookRenderSteps(
      tokens(
        { order: 0, section: "Dough", tokens: [] },
        { order: 1, section: "Dough", tokens: [] },
        { order: 2, section: "Bake", tokens: [] },
        { order: 3, section: null, tokens: [] },
        { order: 4, section: "Dough", tokens: [] }
      )
    );

    expect(steps?.map((s) => s.isSectionStart)).toEqual([true, false, true, false, true]);
    expect(steps?.map((s) => s.section)).toEqual(["Dough", "Dough", "Bake", null, "Dough"]);
  });
});

describe("resolveCookRenderSteps — servings scaling (D-27-W4-03)", () => {
  it("doubles ingredient amounts at 2x servings and leaves timers/text/null amounts untouched", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [
          { type: "text", value: "Add " },
          { type: "ingredient", name: "flour", amount: 100, unit: "gram" },
          { type: "ingredient", name: "salt", amount: null, unit: null },
          { type: "timer", name: "bake", amount: 10, unit: "minutes" },
        ],
      }),
      { baseServings: 4, servings: 8 }
    );

    const [textToken, flour, salt, timer] = steps?.[0]?.tokens ?? [];

    expect(textToken).toEqual({ type: "text", value: "Add " });
    expect(flour?.type === "ingredient" && flour.amount).toBe(200);
    expect(salt?.type === "ingredient" && salt.amount).toBeNull();
    expect(timer?.type === "timer" && timer.amount).toBe(10);
  });

  it("the digit-agreement case: 200g at baseServings 3 -> 7 matches :332's expression bit-for-bit", () => {
    const baseServings = 3;
    const servings = 7;
    const amount = 200;
    // Literally re-running recipe-detail-context.tsx:332's expression — a
    // repeating decimal (200/3 does not terminate), not a clean multiple.
    const expected = Math.round((amount / baseServings) * servings * 10000) / 10000;

    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [{ type: "ingredient", name: "flour", amount, unit: "gram" }],
      }),
      { baseServings, servings }
    );

    const flour = steps?.[0]?.tokens[0];

    // A clean multiple would pass under EITHER expression; this repeating
    // decimal only agrees with :332 under divide-then-multiply.
    expect(amount / baseServings).not.toBe(Math.trunc(amount / baseServings));
    expect(flour?.type === "ingredient" && flour.amount).toBe(expected);
  });

  it("is identity when servings equal baseServings, when options is absent, and when baseServings is falsy", () => {
    const step = {
      order: 0,
      section: null,
      tokens: [{ type: "ingredient" as const, name: "flour", amount: 33.3333, unit: "gram" }],
    };

    const equal = resolveCookRenderSteps(tokens(step), { baseServings: 4, servings: 4 });
    const absent = resolveCookRenderSteps(tokens(step));
    const zeroBase = resolveCookRenderSteps(tokens(step), { baseServings: 0, servings: 8 });
    const nullBase = resolveCookRenderSteps(tokens(step), { baseServings: null, servings: 8 });

    for (const steps of [equal, absent, zeroBase, nullBase]) {
      const flour = steps?.[0]?.tokens[0];

      expect(flour?.type === "ingredient" && flour.amount).toBe(33.3333);
    }
  });

  it("passes NaN and <= 0 amounts through unscaled, mirroring :332's guard", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [
          { type: "ingredient", name: "a", amount: Number.NaN, unit: "gram" },
          { type: "ingredient", name: "b", amount: 0, unit: "gram" },
          { type: "ingredient", name: "c", amount: -5, unit: "gram" },
        ],
      }),
      { baseServings: 2, servings: 10 }
    );

    const [a, b, c] = steps?.[0]?.tokens ?? [];

    expect(a?.type === "ingredient" && Number.isNaN(a.amount)).toBe(true);
    expect(b?.type === "ingredient" && b.amount).toBe(0);
    expect(c?.type === "ingredient" && c.amount).toBe(-5);
  });
});

describe("resolveCookRenderSteps — ingredient token key (D-27-W4-09)", () => {
  it("prefixes the key with systemUsed when provided, and falls back to the bare normalized name otherwise", () => {
    const step = {
      order: 0,
      section: null,
      tokens: [{ type: "ingredient" as const, name: "Brown Sugar", amount: 1, unit: "cup" }],
    };

    const withSystem = resolveCookRenderSteps(tokens(step), { systemUsed: "metric" });
    const withoutSystem = resolveCookRenderSteps(tokens(step));

    const keyed = withSystem?.[0]?.tokens[0];
    const bare = withoutSystem?.[0]?.tokens[0];

    expect(keyed?.type === "ingredient" && keyed.key).toBe("metric:brown sugar");
    expect(bare?.type === "ingredient" && bare.key).toBe("brown sugar");
  });
});

describe("cookStepToMarkdown", () => {
  it("emits text tokens verbatim, ingredient tokens with the amount label, and preserves markdown across tokens", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [
          { type: "text", value: "Add the " },
          { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
          { type: "text", value: " and stir." },
        ],
      }),
      { systemUsed: "metric" }
    );

    const markdown = cookStepToMarkdown(steps![0], format);

    expect(markdown).toBe(
      "Add the [flour (200 gram)](norish-ingredient:metric%3Aflour) and stir."
    );
  });

  it("emits the bare name when the caller's amount label is empty", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [{ type: "ingredient", name: "salt", amount: null, unit: null }],
      })
    );

    const markdown = cookStepToMarkdown(steps![0], format);

    expect(markdown).toBe("[salt](norish-ingredient:salt)");
  });

  it("indexes timer tokens by their position among this step's timers", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [
          { type: "timer", name: "pasta", amount: 10, unit: "minutes" },
          { type: "text", value: " and " },
          { type: "timer", name: "sauce", amount: 25, unit: "minutes" },
        ],
      })
    );

    const markdown = cookStepToMarkdown(steps![0], format);

    expect(markdown).toBe("[pasta](norish-timer:0) and [sauce](norish-timer:1)");
  });

  it("escapes a hostile ingredient name so the output still parses to exactly ONE link, and its href is the norish-ingredient: one", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [
          {
            type: "ingredient",
            name: "flour](javascript:alert(1))",
            amount: null,
            unit: null,
          },
        ],
      })
    );

    const markdown = cookStepToMarkdown(steps![0], format);
    const links = findMarkdownLinks(markdown);

    expect(links).toHaveLength(1);
    expect(links[0]?.href.startsWith("norish-ingredient:")).toBe(true);
    expect(links[0]?.href).not.toContain("javascript:alert");
  });
});

describe("cookStepTimers", () => {
  it("dereferences timer tokens in order with 0-based, per-step indices", () => {
    const steps = resolveCookRenderSteps(
      tokens({
        order: 0,
        section: null,
        tokens: [
          { type: "text", value: "start " },
          { type: "timer", name: "pasta", amount: 10, unit: "minutes" },
          { type: "timer", name: "sauce", amount: 25, unit: "minutes" },
        ],
      })
    );

    const timers = cookStepTimers(steps![0]);

    expect(timers).toEqual([
      { index: 0, name: "pasta", durationMs: 600000 },
      { index: 1, name: "sauce", durationMs: 1500000 },
    ]);
  });
});

describe("cookTimerDurationMs", () => {
  it("resolves minutes to milliseconds", () => {
    expect(cookTimerDurationMs({ amount: 10, unit: "minutes" })).toBe(600000);
  });

  it("falls back to minutes for an unrecognized unit, parity with timer-parser.ts", () => {
    expect(cookTimerDurationMs({ amount: 10, unit: "fortnights" })).toBe(10 * 60 * 1000);
  });

  it("returns null for a null or non-finite amount", () => {
    expect(cookTimerDurationMs({ amount: null, unit: "minutes" })).toBeNull();
    expect(cookTimerDurationMs({ amount: Number.NaN, unit: "minutes" })).toBeNull();
    expect(cookTimerDurationMs({ amount: Number.POSITIVE_INFINITY, unit: "minutes" })).toBeNull();
  });

  it("UNIONS configured keywords with the English built-ins — a config that omits English still resolves 'hours' (D-27-W4-12)", () => {
    const durationMs = cookTimerDurationMs(
      { amount: 2, unit: "hours" },
      { hours: ["uur"], minutes: ["minuut"], seconds: ["seconde"] }
    );

    expect(durationMs).toBe(2 * 3600 * 1000);
  });
});
