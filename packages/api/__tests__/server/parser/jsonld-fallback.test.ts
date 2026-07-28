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

// The Task 2 integration `describe` below (`parseRecipeFromUrl`) drives
// `parseRecipeFromUrl`'s NON-forceAI branches, which read `isAIEnabled` /
// `getContentIndicators` (and, when NOT forcing AI via the `forceAI` argument,
// `shouldAlwaysUseAI` / `isVideoParsingEnabled`) — all of which hit a real DB
// in the unmocked implementation. Every other export (including `getUnits`,
// above) still falls through to the real module.
const mockIsAIEnabled = vi.fn();
const mockShouldAlwaysUseAI = vi.fn();
const mockIsVideoParsingEnabled = vi.fn();
const mockGetContentIndicators = vi.fn();

vi.mock("@norish/shared-server/config/server-config-loader", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@norish/shared-server/config/server-config-loader")
  >();

  return {
    ...actual,
    getUnits: () => mockGetUnits(),
    isAIEnabled: () => mockIsAIEnabled(),
    shouldAlwaysUseAI: () => mockShouldAlwaysUseAI(),
    isVideoParsingEnabled: () => mockIsVideoParsingEnabled(),
    getContentIndicators: () => mockGetContentIndicators(),
  };
});

// `parseRecipeFromUrl`'s other seams (Task 2 integration only — every test
// above this point runs against `tryJsonLdFallback` directly and never
// touches these).
const mockIsVideoUrl = vi.fn(() => false);
const mockFetchViaPlaywright = vi.fn();
const mockExtractRecipeWithAI = vi.fn();
const mockCallRecipeScrapersParser = vi.fn();
const mockAdaptRecipeScrapersResponse = vi.fn();
const mockTryLegacyStructuredRecipeParsing = vi.fn();

vi.mock("@norish/api/helpers", () => ({ isVideoUrl: mockIsVideoUrl }));
vi.mock("@norish/api/parser/fetch", () => ({ fetchViaPlaywright: mockFetchViaPlaywright }));
vi.mock("@norish/api/ai/recipe-parser", () => ({ extractRecipeWithAI: mockExtractRecipeWithAI }));
vi.mock("@norish/api/parser/python/client", () => ({
  callRecipeScrapersParser: mockCallRecipeScrapersParser,
}));
vi.mock("@norish/api/parser/python/adapter", () => ({
  adaptRecipeScrapersResponse: mockAdaptRecipeScrapersResponse,
}));
vi.mock("@norish/api/parser/legacy", () => ({
  tryLegacyStructuredRecipeParsing: mockTryLegacyStructuredRecipeParsing,
}));

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
const { parseRecipeFromUrl } = await import("@norish/api/parser");

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

// ============================================================================
// Task 2: `parseRecipeFromUrl` integration — the fallback is wired at BOTH
// AI-failure exits, and only there. `mockTryExtractRecipeFromJsonLd` (defined
// above, defaulting to the REAL extractor) doubles as "the fallback spy": it
// is the first thing `tryJsonLdFallback` calls, so its call count is exactly
// `tryJsonLdFallback`'s call count. AI STAYS PRIMARY is the thing under test —
// every case where AI succeeds must show ZERO fallback calls.
// ============================================================================

const AI_RECIPE = {
  id: RECIPE_ID,
  name: "AI Recipe",
  url: URL,
  description: undefined,
  notes: undefined,
  image: undefined,
  servings: 2,
  prepMinutes: undefined,
  cookMinutes: undefined,
  totalMinutes: undefined,
  calories: null,
  fat: null,
  carbs: null,
  protein: null,
  systemUsed: "metric",
  recipeIngredients: [
    { ingredientId: null, ingredientName: "egg", amount: 1, unit: null, systemUsed: "metric", order: 0 },
  ],
  steps: [{ step: "Cook it", systemUsed: "metric", order: 1 }],
  tags: [],
  categories: [],
  images: [],
  videos: [],
};

const STRUCTURED_RECIPE = { ...AI_RECIPE, name: "Structured Recipe" };

const NO_JSONLD_HTML = "<html><body>plain content, no schema here</body></html>";
const RECIPE_LIKE_NO_JSONLD_HTML =
  "<html><body>a lovely recipe with ingredient and instructions but no ld+json here</body></html>";

/**
 * The ONE terminal `parseRecipeFromUrl` marker per invocation ("Recipe import:
 * parse path taken", logged by `parser/index.ts` itself) — NOT
 * `jsonld-fallback.ts`'s own separate `parserPath`-tagged outcome log (e.g.
 * "minted" / "below-confidence-gate"), which fires on the SAME invocation
 * whenever the fallback runs and would otherwise double-count.
 */
function infoLogsWithParserPath(): { parserPath?: string; usedAI?: boolean; jsonLdNodeCount?: number }[] {
  return logSpy.info.mock.calls
    .filter((call) => call[1] === "Recipe import: parse path taken")
    .map((call) => call[0] as { parserPath?: string; usedAI?: boolean; jsonLdNodeCount?: number });
}

describe("parseRecipeFromUrl integration — the fallback is wired at both AI-failure exits", () => {
  beforeEach(() => {
    mockIsVideoUrl.mockReturnValue(false);
    mockIsAIEnabled.mockResolvedValue(true);
    mockShouldAlwaysUseAI.mockResolvedValue(false);
    mockIsVideoParsingEnabled.mockResolvedValue(false);
    mockGetContentIndicators.mockResolvedValue({
      schemaIndicators: ["recipe"],
      contentIndicators: ["ingredient", "instructions"],
    });
    mockFetchViaPlaywright.mockResolvedValue(RECIPE_LIKE_NO_JSONLD_HTML);
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: true,
      canonicalUrl: URL,
      parser: {
        mode: "supported",
        scraper: "Example",
        host: "example.com",
        siteName: "Example",
        version: "1.0.0",
      },
      recipe: {},
      media: { images: [], videos: [] },
    });
    mockAdaptRecipeScrapersResponse.mockResolvedValue(STRUCTURED_RECIPE);
    mockTryLegacyStructuredRecipeParsing.mockResolvedValue(null);
    mockExtractRecipeWithAI.mockResolvedValue({ success: true, data: { recipe: AI_RECIPE, cook: null } });
  });

  it('AI succeeds on the first input shape: the fallback is never called; parserPath is "ai"', async () => {
    const result = await parseRecipeFromUrl(URL, RECIPE_ID, [], true);

    expect(result).toEqual({ recipe: AI_RECIPE, usedAI: true, cook: null });
    expect(mockTryExtractRecipeFromJsonLd).not.toHaveBeenCalled();

    const markers = infoLogsWithParserPath();

    expect(markers).toHaveLength(1);
    expect(markers[0]!.parserPath).toBe("ai");
    expect(markers[0]!.jsonLdNodeCount).toBe(0);
  });

  it("useAIOnly, every AI attempt fails, page HAS JSON-LD: resolves via the fallback instead of throwing", async () => {
    mockExtractRecipeWithAI.mockResolvedValue({
      success: false,
      code: "PROVIDER_ERROR",
      error: "provider down",
    });
    mockFetchViaPlaywright.mockResolvedValue(htmlWithJsonLd(FULLY_ANCHORED_RECIPE));

    const result = await parseRecipeFromUrl(URL, RECIPE_ID, [], true);

    expect(result.usedAI).toBe(false);
    expect(result.recipe.name).toBe("Anchored Pancakes");
    expect(mockTryExtractRecipeFromJsonLd).toHaveBeenCalledTimes(1);

    const markers = infoLogsWithParserPath();

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ parserPath: "jsonld-fallback", usedAI: false });
    expect(markers[0]!.jsonLdNodeCount).toBeGreaterThanOrEqual(1);
  });

  it("useAIOnly, every AI attempt fails, page has NO JSON-LD: still throws AI extraction failed", async () => {
    mockExtractRecipeWithAI.mockResolvedValue({
      success: false,
      code: "PROVIDER_ERROR",
      error: "provider down",
    });
    mockFetchViaPlaywright.mockResolvedValue(NO_JSONLD_HTML);

    await expect(parseRecipeFromUrl(URL, RECIPE_ID, [], true)).rejects.toThrow("AI extraction failed");

    // The fallback was still ATTEMPTED (once) — it just had nothing to work with.
    expect(mockTryExtractRecipeFromJsonLd).toHaveBeenCalledTimes(1);
  });

  it('structured parser succeeds: the fallback is never called; parserPath is "structured"', async () => {
    const result = await parseRecipeFromUrl(URL, RECIPE_ID);

    expect(result).toEqual({ recipe: STRUCTURED_RECIPE, usedAI: false, cook: null });
    expect(mockTryExtractRecipeFromJsonLd).not.toHaveBeenCalled();
    expect(mockExtractRecipeWithAI).not.toHaveBeenCalled();

    const markers = infoLogsWithParserPath();

    expect(markers).toHaveLength(1);
    expect(markers[0]!.parserPath).toBe("structured");
    expect(markers[0]!.jsonLdNodeCount).toBe(0);
  });

  it("structured parser fails, AI fallback fails, page HAS JSON-LD: resolves via the fallback rather than throwing", async () => {
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: false,
      error: "WebsiteNotImplementedError",
      message: "unsupported",
      parser: { mode: "supported", scraper: "unknown", version: "1.0.0" },
    });
    mockExtractRecipeWithAI.mockResolvedValue({
      success: false,
      code: "PROVIDER_ERROR",
      error: "provider down",
    });
    mockFetchViaPlaywright.mockResolvedValue(htmlWithJsonLd(FULLY_ANCHORED_RECIPE));

    const result = await parseRecipeFromUrl(URL, RECIPE_ID);

    expect(result.usedAI).toBe(false);
    expect(result.recipe.name).toBe("Anchored Pancakes");
    expect(mockTryExtractRecipeFromJsonLd).toHaveBeenCalledTimes(1);

    const markers = infoLogsWithParserPath();

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ parserPath: "jsonld-fallback" });
  });

  it("everything fails and there is no JSON-LD: the existing hard failure is unchanged (fallback attempted first, at most once)", async () => {
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: false,
      error: "NoSchemaFoundInWildMode",
      message: "no schema",
      parser: { mode: "wild", scraper: "unknown", version: "1.0.0" },
    });
    mockFetchViaPlaywright.mockResolvedValue(NO_JSONLD_HTML);

    await expect(parseRecipeFromUrl(URL, RECIPE_ID)).rejects.toThrow(
      "Page does not appear to contain a recipe."
    );

    expect(mockTryExtractRecipeFromJsonLd).toHaveBeenCalledTimes(1);
    expect(mockExtractRecipeWithAI).not.toHaveBeenCalled();
  });
});
