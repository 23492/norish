// @vitest-environment node
/**
 * `buildCookPayload` — the ONLY minter of a `.cook` (COOK-01 / Phase 27 W2).
 *
 * Runs against the REAL serializer and the REAL WASM parser: the whole point of
 * this function is that it validates its own output, so mocking either half would
 * test nothing.
 *
 * The contract under test (D-27-W2-04):
 *   - a clean round trip returns `{ cookSource, cookTokens }`;
 *   - anything else returns `null` and NEVER throws, so the caller passes no `cook`
 *     argument, the legacy projection write runs unchanged and the user's save
 *     still succeeds;
 *   - the resulting invariant: a stored `cook_source` ALWAYS parses cleanly.
 *   - the failure log carries counts and a reason, NEVER the recipe text (T-27-05).
 */

import type { StructuredRecipe } from "@norish/shared/cooklang";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { computeCookProjection } from "@norish/db/repositories/cook-projection";
import { CookTokensSchema } from "@norish/shared/contracts/zod";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";
import { shutdownCookParsePool } from "../../src/cooklang/pool";

const units = defaultUnits as UnitsMap;

const errorSpy = vi.fn();
const warnSpy = vi.fn();

vi.mock("../../src/logger", () => ({
  parserLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: (...args: unknown[]) => errorSpy(...args),
  },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { buildCookPayload, revalidateCookPayload } = await import(
  "../../src/cooklang/build-payload"
);

describe("buildCookPayload", () => {
  beforeEach(() => {
    errorSpy.mockClear();
    warnSpy.mockClear();
  });

  describe("the happy path", () => {
    for (const fixture of fixtures) {
      it(`mints a clean, self-validating .cook for "${fixture.slug}"`, async () => {
        const payload = await buildCookPayload(fixture.recipe, units);

        expect(payload).not.toBeNull();
        expect(payload!.cookSource).toContain("@");
        expect(() => CookTokensSchema.parse(payload!.cookTokens)).not.toThrow();
        expect(payload!.cookTokens.length).toBeGreaterThan(0);
        expect(errorSpy).not.toHaveBeenCalled();
      });
    }

    it("is deterministic — the same recipe mints byte-identical output", async () => {
      const a = await buildCookPayload(fixtures[0]!.recipe, units);
      const b = await buildCookPayload(fixtures[0]!.recipe, units);

      expect(a!.cookSource).toBe(b!.cookSource);
      expect(a!.cookTokens).toEqual(b!.cookTokens);
    });

    it("emits canonical unit ids into %unit, never a localized label (D-8)", async () => {
      const payload = await buildCookPayload(fixtures[0]!.recipe, units);

      expect(payload!.cookSource).toMatch(/%gram\}/);
      expect(payload!.cookSource).not.toMatch(/%g\}/);
      expect(payload!.cookSource).not.toMatch(/%grams\}/);
    });
  });

  describe("the failure path never costs the user their save (D-27-W2-04)", () => {
    it("returns null instead of throwing when the recipe has no steps", async () => {
      const empty: StructuredRecipe = {
        name: "Nothing here",
        systemUsed: "metric",
        steps: [],
      };

      // `resolves` rather than a `not.toThrow()` wrapper, which is vacuous against
      // a promise: a rejection is not a throw (R6).
      await expect(buildCookPayload(empty, units)).resolves.toBeNull();
    });

    it("logs at ERROR level with counts and a reason when the round trip fails", async () => {
      await buildCookPayload({ name: "Nothing here", systemUsed: "metric", steps: [] }, units);

      expect(errorSpy).toHaveBeenCalled();

      const [payload] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];

      expect(payload).toHaveProperty("stepCount");
      expect(payload).toHaveProperty("ingredientCount");
      expect(payload).toHaveProperty("reason");
    });

    it("NEVER puts recipe prose in the log payload (T-27-05)", async () => {
      const secret = "Marinate the wagyu in the family's secret 12-spice rub";

      await buildCookPayload(
        {
          name: "Secret family recipe",
          systemUsed: "metric",
          // A step whose prose must not leak, on a recipe that cannot round-trip
          // (the heading-only step list yields no parseable step).
          steps: [{ text: `# ${secret}`, order: 0, ingredients: [] }],
        },
        units
      );

      expect(errorSpy).toHaveBeenCalled();

      for (const call of errorSpy.mock.calls) {
        const serialized = JSON.stringify(call);

        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain("wagyu");
        expect(serialized).not.toContain("Secret family recipe");
      }
    });
  });

  describe("the package export map (<risks> R8)", () => {
    it("resolves through the `@norish/shared-server/cooklang/build-payload` specifier", async () => {
      // Nothing imports this module by specifier until W3 wires the producers, so
      // without this the new exports-map entry would ship unproven — the exact shape
      // that broke Phase 26 and bit W1.
      const mod = await import("@norish/shared-server/cooklang/build-payload");

      expect(typeof mod.buildCookPayload).toBe("function");
      expect(mod.buildCookPayload(fixtures[0]!.recipe, units)).not.toBeNull();
    });
  });

  describe("the stored-source invariant", () => {
    it("every non-null cookSource it returns parses cleanly under the real parser", async () => {
      const { parseCookSource } = await import("../../src/cooklang/parse");

      for (const fixture of fixtures) {
        const payload = await buildCookPayload(fixture.recipe, units);

        expect(payload).not.toBeNull();
        // The invariant W4's renderer and W6's `0043 NOT NULL` stand on.
        expect(await parseCookSource(payload!.cookSource, units)).not.toBeNull();
      }
    });
  });

  describe("prose fidelity through to the projection", () => {
    // The full W2 write path in one line: serialize -> parse -> project. The step
    // prose the projection writes must be what the serializer was given.
    it("reconstructs each step's prose byte-identically for an all-inline fixture", async () => {
      const fixture = fixtures.find((f) => f.slug === "pancakes")!;
      const payload = await buildCookPayload(fixture.recipe, units);
      const projection = computeCookProjection({
        systemUsed: fixture.recipe.systemUsed,
        cookTokens: payload!.cookTokens,
        units,
      });
      const expectedProse = fixture.recipe.steps
        .filter((step) => !step.text.trim().startsWith("#"))
        .map((step) => step.text.trim());

      expect(projection.steps.map((s) => s.step)).toEqual(expectedProse);
    });

    it("projects every fixture's ingredients without losing one", async () => {
      for (const fixture of fixtures) {
        const payload = await buildCookPayload(fixture.recipe, units);
        const projection = computeCookProjection({
          systemUsed: fixture.recipe.systemUsed,
          cookTokens: payload!.cookTokens,
          units,
        });
        const distinctNames = new Set(
          fixture.recipe.steps.flatMap((step) =>
            step.ingredients.map((i) => i.name.trim().toLowerCase())
          )
        );

        expect(projection.native.length).toBe(distinctNames.size);
        expect(projection.derived.length).toBe(projection.native.length);
      }
    });
  });
});

/**
 * `revalidateCookPayload` — the copy path's door (T-27-07, W3B).
 *
 * `copyRecipeForSave` used to carry a stored `cook_source` AND its tokens across
 * verbatim, with no re-parse and no bound. This is the function that replaced that
 * trust, and it must be a REAL door: same byte cap, same recognizer, same resource
 * bound as the minting path, and it must return the tokens IT parsed rather than
 * whatever the source row happened to carry.
 */
describe("revalidateCookPayload", () => {
  it("re-proves a good stored source and returns FRESHLY PARSED tokens", async () => {
    const minted = await buildCookPayload(fixtures[0]!.recipe, units);

    expect(minted).not.toBeNull();

    const revalidated = await revalidateCookPayload(minted!.cookSource, units);

    expect(revalidated).not.toBeNull();
    expect(revalidated!.cookSource).toBe(minted!.cookSource);
    // Byte-identical to a fresh mint: the tokens really were re-derived.
    expect(revalidated!.cookTokens).toEqual(minted!.cookTokens);
    expect(() => CookTokensSchema.parse(revalidated!.cookTokens)).not.toThrow();
  });

  it("resolves null for null / undefined / empty, without throwing", async () => {
    await expect(revalidateCookPayload(null)).resolves.toBeNull();
    await expect(revalidateCookPayload(undefined)).resolves.toBeNull();
    await expect(revalidateCookPayload("")).resolves.toBeNull();
  });

  it("REFUSES the H1 artefact — a poisoned row cannot be copied across", async () => {
    const startedAt = performance.now();

    await expect(
      revalidateCookPayload(`---\na: ${"[".repeat(65_400)}\n---\nstep\n`, units)
    ).resolves.toBeNull();

    // Bounded whichever gate catches it, so a poisoned row cannot stall a copy.
    expect(performance.now() - startedAt).toBeLessThan(3_000);
  });

  it("REFUSES an oversize stored source", async () => {
    await expect(revalidateCookPayload("a".repeat(70_000), units)).resolves.toBeNull();
  });

  it("logs the refusal with a reason and byte count, and NO source text", async () => {
    warnSpy.mockClear();

    await revalidateCookPayload("@a{1%} ".repeat(200), units);

    const serialized = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);

    expect(serialized).toContain("not-serializer-shaped");
    expect(serialized).not.toContain("@a{1%}");
  });
});

/**
 * R4: vitest will not exit while a child process lives, so every suite that parses
 * must tear the pool down. A leaked child hangs the whole run.
 */
afterAll(() => {
  shutdownCookParsePool();
});
