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

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { CookTokensSchema } from "@norish/shared/contracts/zod";
import { shutdownCookParsePool } from "../../src/cooklang/pool";

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

/**
 * THE READ PATH DEGRADES UNDER THE NEW BOUND — PROVEN, NOT ASSUMED (W3B).
 *
 * The rest of this file exercises rows the RECOGNIZER refuses, which never reach a
 * child process at all. These two cases are different in kind: the row gets all the
 * way to the parser and the PARSE ITSELF fails, which is the only thing that
 * exercises `parseInPool`'s failure plumbing on a request path. If either of these
 * threw or hung, a single poisoned row would 500 or stall a recipe page.
 */
describe("withCookTokens under a resource bound (T-27-01, never-broken)", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  /**
   * The H1 artefact, which cost 24 557 / 38 511 ms in-process. It is fed with the
   * recognizer BYPASSED — `findCookSourceDefect` is stubbed to `null` — so nothing
   * here can pass because a gate refused the input. The only reason this returns at
   * all is the wall-clock bound.
   */
  it("degrades to cookTokens: null with a warn, bounded, when the parse hits the TIME bound", async () => {
    vi.resetModules();
    vi.doMock("../../src/cooklang/limits", async () => {
      const actual =
        await vi.importActual<typeof import("../../src/cooklang/limits")>("../../src/cooklang/limits");

      return { ...actual, findCookSourceDefect: () => null };
    });

    const { withCookTokens: bounded } = await import("../../src/cooklang/attach-tokens");
    const { shutdownCookParsePool: shutdownBounded } = await import("../../src/cooklang/pool");

    try {
      const startedAt = performance.now();
      const result = await bounded({
        id: "poisoned-row",
        cookSource: `---\na: ${"[".repeat(65_400)}\n---\nstep\n`,
      });
      const elapsed = performance.now() - startedAt;

      // Did not throw, did not hang, and the row still renders — on the legacy path.
      expect(result.cookTokens).toBeNull();
      expect(result.id).toBe("poisoned-row");
      expect(elapsed).toBeLessThan(3_000);
      expect(warnSpy).toHaveBeenCalled();

      // ANTI-VACUITY: this row is only `null` because the BOUND fired. If the
      // `findCookSourceDefect` stub had not taken effect, the recognizer would have
      // refused it at the door in microseconds and this test would have "passed"
      // while proving nothing about the bound. Spending ~1 000 ms is the evidence
      // that the parse really was attempted and really was cut off.
      expect(elapsed).toBeGreaterThan(900);
      expect(
        warnSpy.mock.calls.some(
          (call) => (call[0] as { reason?: string })?.reason === "pool-timeout"
        )
      ).toBe(true);

      // The row is identifiable for W5's backfill, and no prose is logged (T-27-05).
      const serialized = JSON.stringify(warnSpy.mock.calls);

      expect(serialized).toContain("stored-source-did-not-parse");
      expect(serialized).not.toContain("[[[[");
    } finally {
      shutdownBounded();
      vi.doUnmock("../../src/cooklang/limits");
      vi.resetModules();
    }
  });

  /** A child that cannot be spawned at all — the mis-packaged-bundle failure (T-27-09). */
  it("degrades to cookTokens: null when NO child can be spawned", async () => {
    vi.stubEnv("NORISH_COOK_PARSE_WORKER_PATH", "/nonexistent/cook-parse-worker.mjs");
    vi.resetModules();

    const { withCookTokens: broken } = await import("../../src/cooklang/attach-tokens");
    const { shutdownCookParsePool: shutdownBroken } = await import("../../src/cooklang/pool");

    try {
      const result = await broken({ id: "r-nochild", cookSource: VALID_COOK });

      expect(result.cookTokens).toBeNull();
      expect(result.cookSource).toBe(VALID_COOK);
    } finally {
      shutdownBroken();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

/**
 * R4: vitest will not exit while a child process lives, so every suite that parses
 * must tear the pool down. A leaked child hangs the whole run.
 */
afterAll(() => {
  shutdownCookParsePool();
});
