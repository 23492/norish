// @vitest-environment node
/**
 * `tryJsonLdFallback` — Task 1 of 27.1-02 (JSON-LD as a FALLBACK, never a
 * bypass — D-27.1-04 / D-27.1-05).
 *
 * Drives the REAL extractor (`tryExtractRecipeFromJsonLd`), the REAL
 * serializer (`serializeWithReport`) and the REAL `buildCookPayload` (the
 * escaping, the caps, `findCookSourceDefect`, the pooled WASM parser) against
 * hand-written HTML fixtures containing an `application/ld+json` Recipe
 * block. Only `tryExtractRecipeFromJsonLd` itself is wrapped (not mocked away
 * by default — the wrapper calls straight through to the real
 * implementation) so two edge cases that the real extractor cannot produce on
 * its own — a rejecting extractor, and a recipe with a genuinely empty name —
 * can still be exercised directly against the `hasRecipeName` guard.
 *
 * Task 2 extends this file with an integration `describe` driving
 * `parseRecipeFromUrl` end to end (both AI-failure exits, both AI-success
 * short-circuits, and the `parserPath` observability markers).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { findCookSourceDefect } from "@norish/shared-server/cooklang/limits";

const units = defaultUnits as UnitsMap;

// --------------------------------------------------------------------------
// `tryExtractRecipeFromJsonLd` is wrapped, not replaced: by default the mock
// calls straight through to the real implementation (captured below), so
// every fixture-driven test below still exercises the REAL extractor. Only
// the "rejects" and "empty name" tests override it, because neither
// condition is reachable through a well-formed HTML fixture with the real
// parser (a Recipe-typed node with no `name`/`headline` field is given
// "Untitled recipe" by `parseMetadata`'s fallback — see Deviations in the
// SUMMARY).
// --------------------------------------------------------------------------
const mockTryExtractRecipeFromJsonLd = vi.fn();

let actualTryExtractRecipeFromJsonLd:
  typeof import("@norish/api/parser/jsonld")["tryExtractRecipeFromJsonLd"];

vi.mock("@norish/api/parser/jsonld", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/api/parser/jsonld")>();

  actualTryExtractRecipeFromJsonLd = actual.tryExtractRecipeFromJsonLd;

  return {
    ...actual,
    tryExtractRecipeFromJsonLd: (...args: Parameters<typeof actual.tryExtractRecipeFromJsonLd>) =>
      mockTryExtractRecipeFromJsonLd(...args),
  };
});

const logSpy = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => logSpy,
};

vi.mock("@norish/shared-server/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/logger")>();

  return { ...actual, parserLogger: logSpy };
});

const mockGetUnits = vi.fn(async () => units);

vi.mock("@norish/shared-server/config/server-config-loader", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@norish/shared-server/config/server-config-loader")
  >();

  return { ...actual, getUnits: () => mockGetUnits() };
});

/** Flipped by the "mint-refused" case only — same seam `cook-payload.test.ts` uses. */
let forceParseCookSourceNull = false;

vi.mock("@norish/shared-server/cooklang/parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/cooklang/parse")>();

  return {
    ...actual,
    parseCookSource: (source: string, unitsMap?: UnitsMap) =>
      forceParseCookSourceNull ? null : actual.parseCookSource(source, unitsMap),
  };
});

const { tryJsonLdFallback } = await import("@norish/api/parser/jsonld-fallback");

const RECIPE_ID = "recipe-jsonld-fallback";
const URL = "https://example.com/recipe";

function htmlWithJsonLd(recipeJson: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(recipeJson)}</script></head><body></body></html>`;
}

const FULLY_ANCHORED_RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Anchored Pancakes",
  recipeIngredient: ["200 g flour", "300 ml milk"],
  recipeInstructions: [
    "Whisk the flour and milk together in a large bowl.",
    "Cook the batter in a hot pan until golden.",
  ],
};

const POORLY_ANCHORED_RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Drifted Stew",
  recipeIngredient: ["1 tsp salt", "1 tsp pepper", "2 cloves garlic"],
  recipeInstructions: ["Combine everything in a pot and simmer until done."],
};

beforeEach(() => {
  vi.clearAllMocks();
  forceParseCookSourceNull = false;
  mockGetUnits.mockResolvedValue(units);
  mockTryExtractRecipeFromJsonLd.mockImplementation(
    (...args: Parameters<typeof actualTryExtractRecipeFromJsonLd>) =>
      actualTryExtractRecipeFromJsonLd(...args)
  );
});

describe("tryJsonLdFallback", () => {
  it("returns null when the HTML carries no recipe JSON-LD node", async () => {
    const html = "<html><head></head><body><p>Just a blog post, no recipe here.</p></body></html>";

    const result = await tryJsonLdFallback(URL, html, RECIPE_ID);

    expect(result).toBeNull();
  });

  it("returns null when extraction yields a recipe with no name (hasRecipeName false)", async () => {
    // Not reachable via the real extractor (`parseMetadata` falls back to
    // "Untitled recipe" when no name/headline is present) — the guard is
    // exercised directly here, mirroring `tryLegacyStructuredRecipeParsing`'s
    // identical `hasRecipeName` guard.
    mockTryExtractRecipeFromJsonLd.mockResolvedValueOnce({
      id: RECIPE_ID,
      name: "",
      description: null,
      notes: null,
      url: URL,
      image: null,
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      calories: null,
      fat: null,
      carbs: null,
      protein: null,
      systemUsed: "metric",
      steps: [],
      recipeIngredients: [],
      tags: [],
      categories: [],
      images: [],
      videos: [],
    } as never);

    const result = await tryJsonLdFallback(URL, htmlWithJsonLd(FULLY_ANCHORED_RECIPE), RECIPE_ID);

    expect(result).toBeNull();
  });

  it("resolves to null (never rejects) when the extractor throws", async () => {
    mockTryExtractRecipeFromJsonLd.mockRejectedValueOnce(new Error("extractor exploded"));

    await expect(
      tryJsonLdFallback(URL, htmlWithJsonLd(FULLY_ANCHORED_RECIPE), RECIPE_ID)
    ).resolves.toBeNull();
  });

  it("returns the recipe unmodified from tryExtractRecipeFromJsonLd on a complete page", async () => {
    const html = htmlWithJsonLd(FULLY_ANCHORED_RECIPE);

    const result = await tryJsonLdFallback(URL, html, RECIPE_ID);

    expect(result).not.toBeNull();
    expect(result!.recipe.name).toBe("Anchored Pancakes");
    expect(result!.recipe.recipeIngredients).toHaveLength(2);
    expect(result!.recipe.steps).toHaveLength(2);
  });

  it("mints a cleanly-parsing .cook when every ingredient is anchored in step prose", async () => {
    const html = htmlWithJsonLd(FULLY_ANCHORED_RECIPE);

    const result = await tryJsonLdFallback(URL, html, RECIPE_ID);

    expect(result).not.toBeNull();
    expect(result!.cook).not.toBeNull();
    expect(findCookSourceDefect(result!.cook!.cookSource)).toBeNull();
  });

  it("returns cook: null (and still returns the recipe) when buildCookPayload refuses (did-not-parse-cleanly)", async () => {
    forceParseCookSourceNull = true;

    const html = htmlWithJsonLd(FULLY_ANCHORED_RECIPE);

    const result = await tryJsonLdFallback(URL, html, RECIPE_ID);

    expect(result).not.toBeNull();
    expect(result!.recipe).toBeTruthy();
    expect(result!.cook).toBeNull();

    const mintLog = logSpy.info.mock.calls.find(
      (call) => (call[0] as { outcome?: string })?.outcome === "mint-refused"
    );

    expect(mintLog).toBeTruthy();
  });

  it("returns cook: null (and still returns the recipe) when most ingredients are unanchored", async () => {
    const html = htmlWithJsonLd(POORLY_ANCHORED_RECIPE);

    const result = await tryJsonLdFallback(URL, html, RECIPE_ID);

    expect(result).not.toBeNull();
    expect(result!.recipe).toBeTruthy();
    expect(result!.cook).toBeNull();

    // None of the three ingredients ("salt", "pepper", "garlic") are named in
    // the single lumped step ("Combine everything..."), so every link is
    // "appended" and the fixture scores exactly 0 — recorded verbatim in
    // 27.1-02-SUMMARY.md per the plan's output spec.
    const gateLog = logSpy.info.mock.calls.find(
      (call) => (call[0] as { outcome?: string })?.outcome === "below-confidence-gate"
    );

    expect(gateLog).toBeTruthy();
    expect((gateLog![0] as { confidence: number }).confidence).toBe(0);
  });

  it("returns cook: null when buildStructuredRecipeFromLegacy refuses (no-native-steps)", async () => {
    // A recipe whose only instructions collapse to nothing (empty strings /
    // whitespace) leaves the native system with zero steps once
    // `parseSteps`'s own dedupe/blank-filtering runs — `buildCookPayload`'s
    // caller (`buildStructuredRecipeFromLegacy`) then refuses rather than
    // seeding an empty structured recipe.
    const html = htmlWithJsonLd({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "No Steps Recipe",
      recipeIngredient: ["1 cup flour"],
      recipeInstructions: [],
    });

    const result = await tryJsonLdFallback(URL, html, RECIPE_ID);

    expect(result).not.toBeNull();
    expect(result!.recipe).toBeTruthy();
    expect(result!.cook).toBeNull();

    const refusalLog = logSpy.info.mock.calls.find(
      (call) => (call[0] as { outcome?: string })?.outcome === "seed-refused"
    );

    expect(refusalLog).toBeTruthy();
    expect((refusalLog![0] as { reason: string }).reason).toBe("no-native-steps");
  });

  it("never throws — a thrown extractor degrades to null, never rejecting the caller", async () => {
    mockTryExtractRecipeFromJsonLd.mockImplementationOnce(() => {
      throw new Error("synchronous throw");
    });

    await expect(
      tryJsonLdFallback(URL, htmlWithJsonLd(FULLY_ANCHORED_RECIPE), RECIPE_ID)
    ).resolves.toBeNull();
  });

  it("never logs a recipe name, an ingredient name or step prose from this module (T-27-05)", async () => {
    const html = htmlWithJsonLd(FULLY_ANCHORED_RECIPE);

    await tryJsonLdFallback(URL, html, RECIPE_ID);

    // Scoped to log lines THIS module emits (tagged `parserPath:
    // "jsonld-fallback"`). `normalizeRecipeFromJson` (a pre-existing,
    // out-of-scope dependency) debug-logs the raw JSON-LD node itself — that
    // pre-existing behavior is not this module's contract to keep.
    const ownLogPayloads = [
      ...logSpy.info.mock.calls,
      ...logSpy.warn.mock.calls,
      ...logSpy.error.mock.calls,
    ]
      .filter((call) => (call[0] as { parserPath?: string })?.parserPath === "jsonld-fallback")
      .map((call) => JSON.stringify(call))
      .join("\n");

    expect(ownLogPayloads.length).toBeGreaterThan(0);
    expect(ownLogPayloads).not.toContain("Anchored Pancakes");
    expect(ownLogPayloads).not.toContain("flour");
    expect(ownLogPayloads).not.toContain("Whisk the flour");
  });
});
