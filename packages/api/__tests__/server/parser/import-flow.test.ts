// @vitest-environment node
/**
 * `parseRecipeFromUrl` — the import-flow branch matrix (video / forceAI /
 * alwaysUseAI / structured-parser success / AI fallback / hard failures /
 * legacy rollback).
 *
 * ⚠ THE SUBJECT IS IMPORTED AT FILE SCOPE, ONCE — DO NOT MOVE IT BACK INTO A TEST.
 * It used to be `await import()`ed inside EVERY one of the 9 tests, behind a
 * per-test `vi.resetModules()`, which charged the transform + evaluation of the
 * whole `@norish/api/parser` graph to the per-test wall budget 9 times over. The
 * first test alone measured **2 742 ms isolated against its own hand-raised
 * 15 000 ms `{ timeout }`** (5.5x headroom) and hit **15 125-14 740 ms and TIMED
 * OUT** under host contention manufactured the same way as
 * `migrate-gallery-images.test.ts` (see that file and `27-04-FIX-GATES.md`
 * G1/G4) — the same wall-clock-under-contention disease D-27-W3B-03a diagnosed
 * for the cooklang parse bound. Worse: the timeout did not stay contained — the
 * timed-out test's in-flight promise kept running in the background past its own
 * `beforeEach`, and a mock call it made landed on the NEXT test's cleared mocks
 * (`mockCallRecipeScrapersParser` recorded a call inside "uses AI directly when
 * forceAI is true"), producing a second, unrelated red test. That collateral
 * failure is gone once the module load — the actual cost — is out of the timed
 * region altogether.
 *
 * The cure is the same one: a top-level `await import` runs during file
 * COLLECTION, which neither `testTimeout` nor `hookTimeout` bounds, and it now
 * runs ONCE instead of 9 times. Every mock seam and every assertion below is
 * unchanged; what changed is only where the module load is accounted. The
 * subject holds no module-level mutable state — `parserEnvConfig` is a live
 * binding to the SAME `mockServerConfig` object every test mutates in place, so
 * a single import sees every later mutation with no re-import needed — so
 * `vi.resetModules()` bought no isolation here; it only paid for 8 redundant
 * re-evaluations of the module graph. Removing it is not a coverage trade: the
 * per-test `vi.clearAllMocks()` plus fresh `mockResolvedValue`/`mockReturnValue`
 * calls in `beforeEach` are what actually isolate these tests, and both are kept
 * verbatim.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExtractRecipeWithAI = vi.fn();
const mockIsVideoUrl = vi.fn(() => false);
const mockFetchViaPlaywright = vi.fn();
const mockCallRecipeScrapersParser = vi.fn();
const mockAdaptRecipeScrapersResponse = vi.fn();
const mockTryLegacyStructuredRecipeParsing = vi.fn();
const mockProcessVideoRecipe = vi.fn();
const mockIsAIEnabled = vi.fn();
const mockShouldAlwaysUseAI = vi.fn();
const mockIsVideoParsingEnabled = vi.fn();
const mockGetContentIndicators = vi.fn();
const mockShouldUseLegacyRecipeParserRollback = vi.fn();
const mockServerConfig = {
  LEGACY_RECIPE_PARSER_ROLLBACK: false,
  UPLOADS_DIR: "/tmp/uploads",
  MAX_IMAGE_FILE_SIZE: 10 * 1024 * 1024,
  YT_DLP_BIN_DIR: "/tmp/bin",
  YT_DLP_VERSION: "2025.11.12",
  // 27.1-02: `parser/index.ts` now imports the JSON-LD fallback, which pulls
  // in `@norish/db/repositories/recipes` -> `./server-config` ->
  // `@norish/config/src/crypto.ts`, which derives its module-scope key
  // constants from `SERVER_CONFIG.MASTER_KEY` at IMPORT time. Without a
  // (fake, test-only) base64 value here, importing this test file's subject
  // throws before a single test runs. Same fixture value already used by
  // `migrate-gallery-images.test.ts`.
  MASTER_KEY: "QmFzZTY0RW5jb2RlZE1hc3RlcktleU1pbjMyQ2hhcnM=",
};

vi.mock("@norish/api/ai/recipe-parser", () => ({
  extractRecipeWithAI: mockExtractRecipeWithAI,
}));

vi.mock("@norish/api/helpers", () => ({
  isVideoUrl: mockIsVideoUrl,
}));

vi.mock("@norish/api/parser/fetch", () => ({
  fetchViaPlaywright: mockFetchViaPlaywright,
}));

vi.mock("@norish/api/parser/python/client", () => ({
  callRecipeScrapersParser: mockCallRecipeScrapersParser,
}));

vi.mock("@norish/api/parser/python/adapter", () => ({
  adaptRecipeScrapersResponse: mockAdaptRecipeScrapersResponse,
}));

vi.mock("@norish/api/parser/legacy", () => ({
  tryLegacyStructuredRecipeParsing: mockTryLegacyStructuredRecipeParsing,
}));

vi.mock("@norish/api/video/processor", () => ({
  processVideoRecipe: mockProcessVideoRecipe,
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getContentIndicators: mockGetContentIndicators,
  isAIEnabled: mockIsAIEnabled,
  isVideoParsingEnabled: mockIsVideoParsingEnabled,
  shouldAlwaysUseAI: mockShouldAlwaysUseAI,
  shouldUseLegacyRecipeParserRollback: mockShouldUseLegacyRecipeParserRollback,
}));

vi.mock("@norish/config/env-config-server", () => ({
  SERVER_CONFIG: mockServerConfig,
}));

const mockLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};

vi.mock("@norish/shared-server/logger", () => ({
  parserLogger: mockLogger,
  serverLogger: mockLogger,
  createLogger: vi.fn(() => mockLogger),
}));

const { parseRecipeFromUrl } = await import("@norish/api/parser");

describe("parseRecipeFromUrl import flow", () => {
  const structuredRecipe = {
    id: "recipe-1",
    name: "Structured Recipe",
    url: "https://example.com/recipe",
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
      {
        ingredientId: null,
        ingredientName: "egg",
        amount: 1,
        unit: null,
        systemUsed: "metric",
        order: 0,
      },
    ],
    steps: [{ step: "Cook it", systemUsed: "metric", order: 1 }],
    tags: [],
    categories: [],
    images: [],
    videos: [],
  };

  const aiRecipe = {
    ...structuredRecipe,
    name: "AI Recipe",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsVideoUrl.mockReturnValue(false);
    mockFetchViaPlaywright.mockResolvedValue("<html><body>recipe html</body></html>");
    mockIsAIEnabled.mockResolvedValue(true);
    mockShouldAlwaysUseAI.mockResolvedValue(false);
    mockIsVideoParsingEnabled.mockResolvedValue(false);
    mockGetContentIndicators.mockResolvedValue({
      schemaIndicators: ["recipe"],
      contentIndicators: ["ingredient", "instructions"],
    });
    mockShouldUseLegacyRecipeParserRollback.mockReturnValue(false);
    mockServerConfig.LEGACY_RECIPE_PARSER_ROLLBACK = false;
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: true,
      canonicalUrl: "https://example.com/recipe",
      parser: {
        mode: "supported",
        scraper: "AllRecipes",
        host: "example.com",
        siteName: "Example",
        version: "15.10.0",
      },
      recipe: {},
      media: { images: [], videos: [] },
    });
    mockAdaptRecipeScrapersResponse.mockResolvedValue(structuredRecipe);
    mockTryLegacyStructuredRecipeParsing.mockResolvedValue(null);
    // W3 / D-27-W3-02: the AI producers return `{ recipe, cook }`, not a bare DTO.
    // `cook: null` is the ordinary case (no linkage earned) and keeps every
    // expectation below about ingredient/step behaviour exactly as it was.
    mockProcessVideoRecipe.mockResolvedValue({ recipe: structuredRecipe, cook: null });
    mockExtractRecipeWithAI.mockResolvedValue({
      success: true,
      data: { recipe: aiRecipe, cook: null },
    });
  });

  it("uses the existing video pipeline for video imports", async () => {
    mockIsVideoUrl.mockReturnValue(true);
    mockIsVideoParsingEnabled.mockResolvedValue(true);

    const result = await parseRecipeFromUrl("https://example.com/video", "recipe-1", ["dairy"]);

    expect(result).toEqual({ recipe: structuredRecipe, usedAI: true, cook: null });
    expect(mockProcessVideoRecipe).toHaveBeenCalledWith(
      "https://example.com/video",
      "recipe-1",
      ["dairy"],
      undefined
    );
    expect(mockFetchViaPlaywright).not.toHaveBeenCalled();
    expect(mockCallRecipeScrapersParser).not.toHaveBeenCalled();
    expect(mockExtractRecipeWithAI).not.toHaveBeenCalled();
  });

  it("uses AI directly when forceAI is true", async () => {
    const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true);

    expect(result).toEqual({ recipe: aiRecipe, usedAI: true, cook: null });
    expect(mockCallRecipeScrapersParser).not.toHaveBeenCalled();
    expect(mockExtractRecipeWithAI).toHaveBeenCalled();
  });

  it("uses AI directly when alwaysUseAI is enabled", async () => {
    mockShouldAlwaysUseAI.mockResolvedValue(true);

    const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1");

    expect(result).toEqual({ recipe: aiRecipe, usedAI: true, cook: null });
    expect(mockCallRecipeScrapersParser).not.toHaveBeenCalled();
  });

  it("returns a successful Python parser result without running AI", async () => {
    const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1");

    expect(result).toEqual({ recipe: structuredRecipe, usedAI: false, cook: null });
    expect(mockCallRecipeScrapersParser).toHaveBeenCalled();
    expect(mockGetContentIndicators).not.toHaveBeenCalled();
    expect(mockExtractRecipeWithAI).not.toHaveBeenCalled();
  });

  it("falls back to AI when the Python parser output is invalid and the page still looks recipe-like", async () => {
    mockAdaptRecipeScrapersResponse.mockResolvedValue(null);

    const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1");

    expect(result).toEqual({ recipe: aiRecipe, usedAI: true, cook: null });
    expect(mockGetContentIndicators).toHaveBeenCalled();
  });

  it("falls back to AI on structured parser failure when AI is enabled and the page is recipe-like", async () => {
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: false,
      error: "WebsiteNotImplementedError",
      message: "unsupported",
      parser: { mode: "supported", scraper: "unknown", version: "15.10.0" },
    });

    const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1");

    expect(result).toEqual({ recipe: aiRecipe, usedAI: true, cook: null });
    expect(mockExtractRecipeWithAI).toHaveBeenCalled();
  });

  it("hard-fails when parser failure occurs and the page does not look recipe-like", async () => {
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: false,
      error: "NoSchemaFoundInWildMode",
      message: "no schema",
      parser: { mode: "wild", scraper: "unknown", version: "15.10.0" },
    });
    mockFetchViaPlaywright.mockResolvedValue("<html><body>plain text</body></html>");

    await expect(parseRecipeFromUrl("https://example.com/page", "recipe-1")).rejects.toThrow(
      "Page does not appear to contain a recipe."
    );
    expect(mockExtractRecipeWithAI).not.toHaveBeenCalled();
  });

  it("hard-fails when parser failure occurs and AI is disabled", async () => {
    mockCallRecipeScrapersParser.mockResolvedValue({
      ok: false,
      error: "RecipeSchemaNotFound",
      message: "missing schema",
      parser: { mode: "supported", scraper: "Example", version: "15.10.0" },
    });
    mockIsAIEnabled.mockResolvedValue(false);

    await expect(parseRecipeFromUrl("https://example.com/page", "recipe-1")).rejects.toThrow(
      "Page does not appear to contain a recipe."
    );
    expect(mockExtractRecipeWithAI).not.toHaveBeenCalled();
  });

  it("uses the deprecated legacy parser only when the rollback flag is enabled", async () => {
    mockShouldUseLegacyRecipeParserRollback.mockReturnValue(true);
    mockServerConfig.LEGACY_RECIPE_PARSER_ROLLBACK = true;
    mockTryLegacyStructuredRecipeParsing.mockResolvedValue(structuredRecipe);

    const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1");

    expect(result).toEqual({ recipe: structuredRecipe, usedAI: false, cook: null });
    expect(mockTryLegacyStructuredRecipeParsing).toHaveBeenCalled();
    expect(mockCallRecipeScrapersParser).not.toHaveBeenCalled();
  });
});
