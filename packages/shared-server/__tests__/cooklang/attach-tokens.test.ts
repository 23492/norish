// @vitest-environment node
/**
 * `withCookTokens` — the read-side half of D-27-W2-04 (COOK-01 / Phase 27 W2).
 *
 * Contract: it NEVER throws and never fails a read. A stored `cook_source` that
 * does not parse degrades to `cookTokens: null` (the client falls back to the
 * legacy render path) plus a WARN log, so one poisoned row cannot 500 a recipe
 * page.
 *
 * It is also a PURE PROJECTION — no ctx, no policy, no authorization. The HOUSE-06
 * boundary is its CALL-SITE PLACEMENT, which is pinned by
 * `packages/trpc/__tests__/recipes/cook-tokens-isolation.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { CookTokensSchema } from "@norish/shared/contracts/zod";

const warnSpy = vi.fn();

vi.mock("../../src/logger", () => ({
  parserLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
  },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../src/config/server-config-loader", () => ({
  getUnits: () => Promise.resolve(defaultUnits as UnitsMap),
}));

const { withCookTokens } = await import("../../src/cooklang/attach-tokens");

const VALID_COOK = "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n";

describe("withCookTokens", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  it("returns cookTokens: null and does not warn when cookSource is null", async () => {
    const result = await withCookTokens({ id: "r1", cookSource: null });

    expect(result.cookTokens).toBeNull();
    expect(result.cookSource).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("parses a valid cookSource into a schema-valid token list", async () => {
    const result = await withCookTokens({ id: "r1", cookSource: VALID_COOK });

    expect(result.cookTokens).not.toBeNull();
    expect(() => CookTokensSchema.parse(result.cookTokens)).not.toThrow();

    const names = result.cookTokens!.flatMap((step) =>
      step.tokens.filter((t) => t.type === "ingredient").map((t) => t.name)
    );

    expect(names).toEqual(["flour", "milk"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps every other key on the recipe untouched", async () => {
    const recipe = { id: "r1", cookSource: null, name: "Pancakes", servings: 4 };
    const result = await withCookTokens(recipe);

    expect(result).toEqual({ ...recipe, cookTokens: null });
  });

  it("degrades to cookTokens: null and WARNS when a stored source does not parse", async () => {
    const result = await withCookTokens({ id: "r-broken", cookSource: "~{bad" });

    expect(result.cookSource).toBe("~{bad");
    expect(result.cookTokens).toBeNull();
    expect(warnSpy).toHaveBeenCalled();

    const [payload] = warnSpy.mock.calls.at(-1) as [Record<string, unknown>, string];

    expect(payload.recipeId).toBe("r-broken");
    expect(payload).toHaveProperty("reason");
  });

  it("never throws, whatever the stored source contains", async () => {
    for (const source of ["", "   ", "@@@{{{", "~{bad", "== unterminated"]) {
      await expect(withCookTokens({ id: "r", cookSource: source })).resolves.toBeDefined();
    }
  });

  it("takes no ctx — the boundary is its call site, not its arguments", () => {
    expect(withCookTokens.length).toBe(1);
  });

  it("resolves through the `@norish/shared-server/cooklang/attach-tokens` specifier", async () => {
    const mod = await import("@norish/shared-server/cooklang/attach-tokens");

    expect(typeof mod.withCookTokens).toBe("function");
  });
});
