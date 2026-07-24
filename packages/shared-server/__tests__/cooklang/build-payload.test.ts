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
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { computeCookProjection } from "@norish/db/repositories/cook-projection";
import { CookTokensSchema } from "@norish/shared/contracts/zod";

import { fixtures } from "../../../shared/__tests__/cooklang/fixtures";

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

const { buildCookPayload } = await import("../../src/cooklang/build-payload");

describe("buildCookPayload", () => {
  beforeEach(() => {
    errorSpy.mockClear();
    warnSpy.mockClear();
  });

  describe("the happy path", () => {
    for (const fixture of fixtures) {
      it(`mints a clean, self-validating .cook for "${fixture.slug}"`, () => {
        const payload = buildCookPayload(fixture.recipe, units);

        expect(payload).not.toBeNull();
        expect(payload!.cookSource).toContain("@");
        expect(() => CookTokensSchema.parse(payload!.cookTokens)).not.toThrow();
        expect(payload!.cookTokens.length).toBeGreaterThan(0);
        expect(errorSpy).not.toHaveBeenCalled();
      });
    }

    it("is deterministic — the same recipe mints byte-identical output", () => {
      const a = buildCookPayload(fixtures[0]!.recipe, units);
      const b = buildCookPayload(fixtures[0]!.recipe, units);

      expect(a!.cookSource).toBe(b!.cookSource);
      expect(a!.cookTokens).toEqual(b!.cookTokens);
    });

    it("emits canonical unit ids into %unit, never a localized label (D-8)", () => {
      const payload = buildCookPayload(fixtures[0]!.recipe, units);

      expect(payload!.cookSource).toMatch(/%gram\}/);
      expect(payload!.cookSource).not.toMatch(/%g\}/);
      expect(payload!.cookSource).not.toMatch(/%grams\}/);
    });
  });

  describe("the failure path never costs the user their save (D-27-W2-04)", () => {
    it("returns null instead of throwing when the recipe has no steps", () => {
      const empty: StructuredRecipe = {
        name: "Nothing here",
        systemUsed: "metric",
        steps: [],
      };

      let result: ReturnType<typeof buildCookPayload> | undefined;

      expect(() => {
        result = buildCookPayload(empty, units);
      }).not.toThrow();
      expect(result).toBeNull();
    });

    it("logs at ERROR level with counts and a reason when the round trip fails", () => {
      buildCookPayload({ name: "Nothing here", systemUsed: "metric", steps: [] }, units);

      expect(errorSpy).toHaveBeenCalled();

      const [payload] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];

      expect(payload).toHaveProperty("stepCount");
      expect(payload).toHaveProperty("ingredientCount");
      expect(payload).toHaveProperty("reason");
    });

    it("NEVER puts recipe prose in the log payload (T-27-05)", () => {
      const secret = "Marinate the wagyu in the family's secret 12-spice rub";

      buildCookPayload(
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
        const payload = buildCookPayload(fixture.recipe, units);

        expect(payload).not.toBeNull();
        // The invariant W4's renderer and W6's `0043 NOT NULL` stand on.
        expect(parseCookSource(payload!.cookSource, units)).not.toBeNull();
      }
    });
  });

  describe("prose fidelity through to the projection", () => {
    // The full W2 write path in one line: serialize -> parse -> project. The step
    // prose the projection writes must be what the serializer was given.
    it("reconstructs each step's prose byte-identically for an all-inline fixture", () => {
      const fixture = fixtures.find((f) => f.slug === "pancakes")!;
      const payload = buildCookPayload(fixture.recipe, units);
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

    it("projects every fixture's ingredients without losing one", () => {
      for (const fixture of fixtures) {
        const payload = buildCookPayload(fixture.recipe, units);
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
