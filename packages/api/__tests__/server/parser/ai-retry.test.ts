// @vitest-environment node
/**
 * `parseRecipeFromUrl` / `tryExtractWithAI` — the one-shot AI extraction retry
 * (D-27.1-01 sub-cause 3, D-27.1-06, IMPORT-REL-02).
 *
 * Mirrors `import-flow.test.ts`'s mocking harness (same seam list, same
 * top-level-await-import pattern for the same reason: the module load is
 * charged once, at file COLLECTION, not once per test). `forceAI: true`
 * drives the `useAIOnly` branch in `parseRecipeFromUrl`, which is the branch
 * `tryExtractWithAI` (and therefore the retry) actually runs through, without
 * needing to also exercise the structured-parser fallback machinery.
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
  // constants from `SERVER_CONFIG.MASTER_KEY` at IMPORT time. Same fixture
  // value already used by `migrate-gallery-images.test.ts`.
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

const {
  parseRecipeFromUrl,
  AI_RETRY_OUTPUT_TOKEN_FLOOR,
  AI_RETRY_OUTPUT_TOKEN_TARGET,
  AI_PROVIDER_MAX_OUTPUT_TOKENS,
} = await import("@norish/api/parser");

describe("AI_RETRY_OUTPUT_TOKEN_FLOOR", () => {
  it("is Math.min(AI_RETRY_OUTPUT_TOKEN_TARGET, AI_PROVIDER_MAX_OUTPUT_TOKENS), and resolves to 100000 against today's constants", () => {
    expect(AI_RETRY_OUTPUT_TOKEN_FLOOR).toBe(
      Math.min(AI_RETRY_OUTPUT_TOKEN_TARGET, AI_PROVIDER_MAX_OUTPUT_TOKENS)
    );
    expect(AI_RETRY_OUTPUT_TOKEN_FLOOR).toBe(100_000);
  });
});

describe("tryExtractWithAI — the one-shot retry", () => {
  const aiRecipe = {
    recipe: { name: "AI Recipe" },
    cook: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsVideoUrl.mockReturnValue(false);
    mockFetchViaPlaywright.mockResolvedValue("<html><body>recipe html</body></html>");
    mockIsAIEnabled.mockResolvedValue(true);
    mockShouldAlwaysUseAI.mockResolvedValue(false);
    mockIsVideoParsingEnabled.mockResolvedValue(false);
    mockGetContentIndicators.mockResolvedValue({
      schemaIndicators: [],
      contentIndicators: [],
    });
    mockShouldUseLegacyRecipeParserRollback.mockReturnValue(false);
    mockServerConfig.LEGACY_RECIPE_PARSER_ROLLBACK = false;
  });

  describe("a successful first attempt", () => {
    it("results in exactly one call and no retry", async () => {
      mockExtractRecipeWithAI.mockResolvedValue({ success: true, data: aiRecipe });

      const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true);

      expect(result).toEqual({ recipe: aiRecipe.recipe, usedAI: true, cook: null });
      expect(mockExtractRecipeWithAI).toHaveBeenCalledTimes(1);
    });
  });

  const RETRYABLE_CODES = [
    "PROVIDER_ERROR",
    "EMPTY_RESPONSE",
    "TIMEOUT",
    "NETWORK_ERROR",
    "RATE_LIMIT",
    "VALIDATION_ERROR",
    "UNKNOWN",
  ] as const;

  const NON_RETRYABLE_CODES = ["AI_DISABLED", "AUTH_ERROR", "INVALID_INPUT"] as const;

  it.each(RETRYABLE_CODES)(
    "makes exactly ONE retry call for %s, and returns null (throwing AI extraction failed) after a second failure",
    async (code) => {
      mockExtractRecipeWithAI
        .mockResolvedValueOnce({ success: false, error: "boom", code })
        .mockResolvedValueOnce({ success: false, error: "boom again", code });

      await expect(
        parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true)
      ).rejects.toThrow("AI extraction failed");

      expect(mockExtractRecipeWithAI).toHaveBeenCalledTimes(2);
    }
  );

  it.each(RETRYABLE_CODES)(
    "succeeds on the retry for %s — exactly two calls, final result returned",
    async (code) => {
      mockExtractRecipeWithAI
        .mockResolvedValueOnce({ success: false, error: "boom", code })
        .mockResolvedValueOnce({ success: true, data: aiRecipe });

      const result = await parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true);

      expect(result).toEqual({ recipe: aiRecipe.recipe, usedAI: true, cook: null });
      expect(mockExtractRecipeWithAI).toHaveBeenCalledTimes(2);
    }
  );

  it.each(NON_RETRYABLE_CODES)(
    "does NOT retry %s — exactly one call, then throws",
    async (code) => {
      mockExtractRecipeWithAI.mockResolvedValueOnce({ success: false, error: "boom", code });

      await expect(
        parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true)
      ).rejects.toThrow("AI extraction failed");

      expect(mockExtractRecipeWithAI).toHaveBeenCalledTimes(1);
    }
  );

  it("passes an outputTokenFloor on the SECOND call only — the first call's trailing argument is undefined", async () => {
    mockExtractRecipeWithAI
      .mockResolvedValueOnce({ success: false, error: "boom", code: "PROVIDER_ERROR" })
      .mockResolvedValueOnce({ success: true, data: aiRecipe });

    await parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true);

    expect(mockExtractRecipeWithAI).toHaveBeenCalledTimes(2);

    // extractRecipeWithAI(input, recipeId, url, allergies, originalHtml, options?)
    // — the 6th positional (`options`) is the one the retry adds.
    const firstCallArgs = mockExtractRecipeWithAI.mock.calls[0];
    const secondCallArgs = mockExtractRecipeWithAI.mock.calls[1];

    expect(firstCallArgs[5]).toBeUndefined();
    expect(secondCallArgs[5]).toEqual({ outputTokenFloor: AI_RETRY_OUTPUT_TOKEN_FLOOR });
  });

  it("a first attempt that fails transiently TWICE for the JSON-LD input and TWICE for full HTML still throws AI extraction failed", async () => {
    // No JSON-LD in this HTML, so extractWithAIPreference only tries the
    // full-HTML input once (with its own retry) — see the sibling test above
    // for the "both inputs" shape covered by real JSON-LD-bearing HTML.
    mockFetchViaPlaywright.mockResolvedValue(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: "Recipe",
      })}</script></head><body>recipe html</body></html>`
    );
    mockExtractRecipeWithAI.mockResolvedValue({
      success: false,
      error: "boom",
      code: "PROVIDER_ERROR",
    });

    await expect(
      parseRecipeFromUrl("https://example.com/recipe", "recipe-1", [], true)
    ).rejects.toThrow("AI extraction failed");

    // JSON-LD input attempt (1 + 1 retry) + full-HTML input attempt (1 + 1 retry) = 4
    expect(mockExtractRecipeWithAI).toHaveBeenCalledTimes(4);
  });
});
