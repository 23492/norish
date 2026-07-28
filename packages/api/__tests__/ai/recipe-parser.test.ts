/**
 * `extractRecipeWithAI`'s own output-token floor arithmetic (D-27.1-06,
 * IMPORT-REL-02).
 *
 * This is a SIBLING of `packages/api/__tests__/server/parser/ai-retry.test.ts`,
 * not a merge into it: that file mocks `@norish/api/ai/recipe-parser` wholesale
 * to test `parser/index.ts`'s retry mechanics, which makes it impossible to
 * ALSO exercise `extractRecipeWithAI`'s real implementation in the same file —
 * `vi.mock` intercepts a module by its resolved id for the whole test file,
 * so a module mocked once is mocked everywhere in that file, including for a
 * would-be "real" import. This file instead mocks `extractRecipeWithAI`'s OWN
 * dependencies (`generateText`, `getGenerationSettings`, the normalizer) and
 * imports the REAL `@norish/api/ai/recipe-parser`, mirroring
 * `packages/api/__tests__/ai/auto-tagger.test.ts`'s mocking pattern.
 *
 * @vitest-environment node
 */
import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractRecipeWithAI } from "@norish/api/ai/recipe-parser";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(({ schema }) => schema),
  },
}));

const mockGetGenerationSettings = vi.hoisted(() => vi.fn());

vi.mock("@norish/shared-server/ai/providers", () => ({
  getModels: vi.fn().mockResolvedValue({ model: {}, providerName: "DeepSeek" }),
  getGenerationSettings: mockGetGenerationSettings,
}));

vi.mock("@norish/shared-server/ai/helpers", () => ({
  extractSanitizedBody: vi.fn((html: string) => html),
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getDefaultLocale: vi.fn().mockResolvedValue("en"),
  getUnits: vi.fn().mockResolvedValue([]),
  isAIEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("@norish/shared-server/logger", () => ({
  aiLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@norish/api/ai/prompts/builder", () => ({
  buildRecipeExtractionPrompt: vi.fn().mockResolvedValue("prompt"),
}));

// NOTE: `@norish/api/parser/parsers` is not a defined package export subpath
// (only `@norish/api/parser` and single-file `@norish/api/*.ts` wildcards
// are) — mocking that alias silently misses the resolved module, so the
// REAL `parser/parsers/index.ts` (and its `videos.ts` -> `parserLogger`
// import) loads unmocked. A relative specifier resolves to the identical
// absolute file `src/parser/parsers/index.ts` that `recipe-parser.ts`'s own
// `"../parser/parsers"` import resolves to, so it actually intercepts.
vi.mock("../../src/parser/parsers", () => ({
  extractImageCandidates: vi.fn().mockReturnValue([]),
}));

vi.mock("@norish/api/ai/features/recipe-extraction/normalizer", () => ({
  mirrorMeasurementSystems: vi.fn((output) => output),
  validateExtractionOutput: vi.fn().mockReturnValue({ valid: true, details: {} }),
  normalizeExtractionOutput: vi.fn().mockResolvedValue({ name: "Test Recipe" }),
  buildCookFromExtraction: vi.fn().mockResolvedValue(null),
  getExtractionLogContext: vi.fn().mockReturnValue({}),
}));

const extractionOutput = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Test Recipe",
  recipeIngredient: { metric: ["100g flour"], us: ["1 cup flour"] },
  recipeInstructions: { metric: ["Mix well"], us: ["Mix well"] },
};

describe("extractRecipeWithAI — output-token floor arithmetic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateText).mockResolvedValue({
      output: extractionOutput,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    } as ReturnType<typeof generateText> extends Promise<infer R> ? R : never);
  });

  it("with no options, hands generateText maxOutputTokens exactly equal to getGenerationSettings()'s value", async () => {
    mockGetGenerationSettings.mockResolvedValue({
      temperature: 0.7,
      maxOutputTokens: 4096,
      abortSignal: undefined,
    });

    await extractRecipeWithAI("<html></html>", "recipe-1", "https://example.com");

    const call = vi.mocked(generateText).mock.calls[0][0] as { maxOutputTokens?: number };

    expect(call.maxOutputTokens).toBe(4096);
  });

  it("with { outputTokenFloor: N }, hands generateText Math.max(configured, N) and leaves temperature/abortSignal untouched", async () => {
    const abortSignal = new AbortController().signal;

    mockGetGenerationSettings.mockResolvedValue({
      temperature: 0.7,
      maxOutputTokens: 4096,
      abortSignal,
    });

    await extractRecipeWithAI(
      "<html></html>",
      "recipe-1",
      "https://example.com",
      undefined,
      undefined,
      { outputTokenFloor: 100_000 }
    );

    const call = vi.mocked(generateText).mock.calls[0][0] as {
      maxOutputTokens?: number;
      temperature?: number;
      abortSignal?: AbortSignal;
    };

    expect(call.maxOutputTokens).toBe(100_000);
    expect(call.temperature).toBe(0.7);
    expect(call.abortSignal).toBe(abortSignal);
  });

  it("does NOT lower a configured value that is already above the floor", async () => {
    mockGetGenerationSettings.mockResolvedValue({
      temperature: 0.5,
      maxOutputTokens: 200_000,
      abortSignal: undefined,
    });

    await extractRecipeWithAI(
      "<html></html>",
      "recipe-1",
      "https://example.com",
      undefined,
      undefined,
      { outputTokenFloor: 100_000 }
    );

    const call = vi.mocked(generateText).mock.calls[0][0] as { maxOutputTokens?: number };

    expect(call.maxOutputTokens).toBe(200_000);
  });

  it("treats a missing configured maxOutputTokens as 0 when applying the floor", async () => {
    mockGetGenerationSettings.mockResolvedValue({
      temperature: 0.5,
      maxOutputTokens: undefined,
      abortSignal: undefined,
    });

    await extractRecipeWithAI(
      "<html></html>",
      "recipe-1",
      "https://example.com",
      undefined,
      undefined,
      { outputTokenFloor: 100_000 }
    );

    const call = vi.mocked(generateText).mock.calls[0][0] as { maxOutputTokens?: number };

    expect(call.maxOutputTokens).toBe(100_000);
  });
});
