// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerConfigKeys } from "@norish/config/zod/server-config";

const mockGetConfig = vi.fn();
const mockSetConfig = vi.fn();
const mockDeleteConfig = vi.fn();
const mockConfigExists = vi.fn();
const mockNormalizeAndBackfillConfig = vi.fn();
let mockServerConfig: Record<string, unknown> = {};

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: mockGetConfig,
  setConfig: mockSetConfig,
  deleteConfig: mockDeleteConfig,
  configExists: mockConfigExists,
  normalizeAndBackfillConfig: mockNormalizeAndBackfillConfig,
}));

vi.mock("@norish/auth/provider-cache", () => ({
  setAuthProviderCache: vi.fn(),
}));

vi.mock("@norish/shared-server/logger", () => ({
  serverLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@norish/config/env-config-server", () => ({
  get SERVER_CONFIG() {
    return mockServerConfig;
  },
}));

vi.mock("@norish/config/units.default.json", () => ({ default: {} }));
vi.mock("@norish/config/content-indicators.default.json", () => ({
  default: { schemaIndicators: [], contentIndicators: [] },
}));
vi.mock("@norish/config/recurrence-config.default.json", () => ({
  default: { locales: {} },
}));
vi.mock("@norish/shared-server/ai/prompts/loader", () => ({
  loadDefaultPrompts: vi.fn().mockReturnValue({
    recipeExtraction: "mock recipe extraction prompt",
    unitConversion: "mock unit conversion prompt",
  }),
}));

/**
 * Baseline env that satisfies the AI sync gate (AI_API_KEY set) and carries all the
 * operator fields the SERVER_CONFIG zod schema would normally supply as defaults.
 */
const aiEnvConfig = {
  AI_ENABLED: true,
  AI_PROVIDER: "deepseek",
  AI_ENDPOINT: undefined,
  AI_MODEL: "deepseek-chat",
  AI_API_KEY: "sk-deepseek-env",
  AI_TEMPERATURE: 1.0,
  AI_MAX_TOKENS: 10000,
  AI_TIMEOUT_MS: 300000,
  // Transcription disabled by default so the video sync stays a no-op in AI-only tests.
  TRANSCRIPTION_PROVIDER: "disabled",
};

describe("AI + Video Operator Config Env Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerConfig = {};
    mockDeleteConfig.mockResolvedValue(undefined);
    mockNormalizeAndBackfillConfig.mockResolvedValue(false);
    // Default: every config key already exists (REQUIRED_CONFIGS seeded), so
    // seedMissingConfigs() does nothing and we isolate the env-sync behavior.
    mockConfigExists.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.resetModules();
  });

  const aiCall = () =>
    mockSetConfig.mock.calls.find((call) => call[0] === ServerConfigKeys.AI_CONFIG);
  const videoCall = () =>
    mockSetConfig.mock.calls.find((call) => call[0] === ServerConfigKeys.VIDEO_CONFIG);

  describe("syncAIConfigFromEnv", () => {
    it("seeds ai_config from env when the DB row is the empty-key default (clean-DB drift fix)", async () => {
      // Arrange — the exact production bug: clean DB seeded the default empty-key row.
      mockServerConfig = { ...aiEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.AI_CONFIG) {
          return Promise.resolve({
            enabled: false,
            provider: "openai",
            model: "gpt-5-mini",
            apiKey: undefined,
            temperature: 1.0,
            maxTokens: 10000,
            timeoutMs: 300000,
            autoTagAllergies: true,
            alwaysUseAI: false,
            autoTaggingMode: "disabled",
          });
        }

        return Promise.resolve(null);
      });
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert — env wins: provider/model/apiKey/enabled overwritten from env.
      expect(aiCall()).toBeDefined();
      expect(aiCall()![1]).toMatchObject({
        enabled: true,
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-deepseek-env",
      });
      // Written sensitive=true so the apiKey is encrypted at rest.
      expect(aiCall()![3]).toBe(true);
    });

    it("UPDATES a stale admin-edited DB row (env is source of truth, no isOverridden escape)", async () => {
      // Arrange — admin had set a different provider/key in the DB; env must still win.
      mockServerConfig = { ...aiEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.AI_CONFIG) {
          return Promise.resolve({
            enabled: true,
            provider: "openai",
            model: "gpt-4o",
            apiKey: "sk-OLD-admin",
            temperature: 0.5,
            maxTokens: 8000,
            timeoutMs: 300000,
            autoTagAllergies: true,
            alwaysUseAI: false,
            autoTaggingMode: "disabled",
          });
        }

        return Promise.resolve(null);
      });
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert — env overwrites the stale DB values.
      expect(aiCall()).toBeDefined();
      expect(aiCall()![1]).toMatchObject({
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-deepseek-env",
        temperature: 1.0,
        maxTokens: 10000,
      });
    });

    it("PRESERVES admin-behavior fields (autoTaggingMode/alwaysUseAI/autoTagAllergies/visionModel)", async () => {
      // Arrange — admin tuned behavior toggles; env only owns the provider/key subset.
      mockServerConfig = { ...aiEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.AI_CONFIG) {
          return Promise.resolve({
            enabled: false,
            provider: "openai",
            model: "gpt-5-mini",
            apiKey: undefined,
            visionModel: "gpt-4o-vision",
            temperature: 1.0,
            maxTokens: 10000,
            timeoutMs: 300000,
            autoTagAllergies: false,
            alwaysUseAI: true,
            autoTaggingMode: "freeform",
          });
        }

        return Promise.resolve(null);
      });
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert — operator subset from env, behavior fields from the DB row.
      expect(aiCall()).toBeDefined();
      expect(aiCall()![1]).toMatchObject({
        provider: "deepseek",
        apiKey: "sk-deepseek-env",
        visionModel: "gpt-4o-vision",
        autoTagAllergies: false,
        alwaysUseAI: true,
        autoTaggingMode: "freeform",
      });
    });

    it("does NOT rewrite ai_config when env matches the DB row (no needless version bump)", async () => {
      // Arrange — DB already equals what env would produce (admin fields at defaults).
      mockServerConfig = { ...aiEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.AI_CONFIG) {
          return Promise.resolve({
            enabled: true,
            provider: "deepseek",
            endpoint: undefined,
            model: "deepseek-chat",
            apiKey: "sk-deepseek-env",
            temperature: 1.0,
            maxTokens: 10000,
            timeoutMs: 300000,
            visionModel: undefined,
            autoTagAllergies: true,
            alwaysUseAI: false,
            autoTaggingMode: "disabled",
          });
        }

        return Promise.resolve(null);
      });
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert — no AI_CONFIG write.
      expect(aiCall()).toBeUndefined();
    });

    it("is a NO-OP when neither AI_API_KEY nor AI_ENDPOINT is set (DB/admin remains authoritative)", async () => {
      // Arrange — no AI env gate satisfied.
      mockServerConfig = { TRANSCRIPTION_PROVIDER: "disabled" };
      mockGetConfig.mockResolvedValue(null);
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert
      expect(aiCall()).toBeUndefined();
    });

    it("gates on AI_ENDPOINT alone for local providers (ollama, no API key)", async () => {
      // Arrange — local provider via endpoint, no key.
      mockServerConfig = {
        AI_ENABLED: true,
        AI_PROVIDER: "ollama",
        AI_ENDPOINT: "http://ollama:11434",
        AI_MODEL: "llama3.1",
        AI_API_KEY: undefined,
        AI_TEMPERATURE: 1.0,
        AI_MAX_TOKENS: 10000,
        AI_TIMEOUT_MS: 300000,
        TRANSCRIPTION_PROVIDER: "disabled",
      };
      mockGetConfig.mockResolvedValue(null);
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert — seeded from env even though apiKey is absent.
      expect(aiCall()).toBeDefined();
      expect(aiCall()![1]).toMatchObject({
        provider: "ollama",
        endpoint: "http://ollama:11434",
        model: "llama3.1",
      });
    });

    it("re-seeds identically across two boots (env stays authoritative)", async () => {
      // Boot 1 — clean DB default row, env seeds deepseek.
      mockServerConfig = { ...aiEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.AI_CONFIG) {
          return Promise.resolve({
            enabled: false,
            provider: "openai",
            model: "gpt-5-mini",
            apiKey: undefined,
            temperature: 1.0,
            maxTokens: 10000,
            timeoutMs: 300000,
            autoTagAllergies: true,
            alwaysUseAI: false,
            autoTaggingMode: "disabled",
          });
        }

        return Promise.resolve(null);
      });
      let { seedServerConfig } = await import("@norish/api/startup/seed-config");
      await seedServerConfig();
      expect(aiCall()![1]).toMatchObject({ provider: "deepseek", apiKey: "sk-deepseek-env" });

      // Boot 2 — DB now equals env; no rewrite.
      vi.resetModules();
      mockSetConfig.mockClear();
      mockServerConfig = { ...aiEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.AI_CONFIG) {
          return Promise.resolve({
            enabled: true,
            provider: "deepseek",
            endpoint: undefined,
            model: "deepseek-chat",
            apiKey: "sk-deepseek-env",
            temperature: 1.0,
            maxTokens: 10000,
            timeoutMs: 300000,
            visionModel: undefined,
            autoTagAllergies: true,
            alwaysUseAI: false,
            autoTaggingMode: "disabled",
          });
        }

        return Promise.resolve(null);
      });
      ({ seedServerConfig } = await import("@norish/api/startup/seed-config"));
      await seedServerConfig();
      expect(aiCall()).toBeUndefined();
    });
  });

  describe("syncVideoConfigFromEnv (transcription)", () => {
    const videoEnvConfig = {
      VIDEO_PARSING_ENABLED: true,
      VIDEO_MAX_LENGTH_SECONDS: 120,
      MAX_VIDEO_FILE_SIZE: 100 * 1024 * 1024,
      YT_DLP_VERSION: "2025.11.12",
      YT_DLP_PROXY: undefined,
      TRANSCRIPTION_PROVIDER: "assemblyai",
      TRANSCRIPTION_ENDPOINT: undefined,
      TRANSCRIPTION_API_KEY: "aai-env-key",
      TRANSCRIPTION_MODEL: "best",
    };

    it("seeds video_config transcription from env on boot (AssemblyAI)", async () => {
      // Arrange
      mockServerConfig = { ...videoEnvConfig };
      mockGetConfig.mockImplementation((key: string) => {
        if (key === ServerConfigKeys.VIDEO_CONFIG) {
          return Promise.resolve({
            enabled: false,
            maxLengthSeconds: 120,
            maxVideoFileSize: 100 * 1024 * 1024,
            ytDlpVersion: "2025.11.12",
            transcriptionProvider: "disabled",
            transcriptionModel: "whisper-1",
          });
        }

        return Promise.resolve(null);
      });
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert — env transcription wins; sensitive=true (key encrypted).
      expect(videoCall()).toBeDefined();
      expect(videoCall()![1]).toMatchObject({
        enabled: true,
        transcriptionProvider: "assemblyai",
        transcriptionApiKey: "aai-env-key",
        transcriptionModel: "best",
      });
      expect(videoCall()![3]).toBe(true);
    });

    it("is a NO-OP when TRANSCRIPTION_PROVIDER is disabled", async () => {
      // Arrange — provider disabled even though a key is present.
      mockServerConfig = {
        TRANSCRIPTION_PROVIDER: "disabled",
        TRANSCRIPTION_API_KEY: "aai-env-key",
      };
      mockGetConfig.mockResolvedValue(null);
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert
      expect(videoCall()).toBeUndefined();
    });

    it("is a NO-OP when the transcription provider is set but no key/endpoint is provided", async () => {
      // Arrange — provider chosen but incomplete (no key, no endpoint).
      mockServerConfig = {
        TRANSCRIPTION_PROVIDER: "assemblyai",
        TRANSCRIPTION_API_KEY: undefined,
        TRANSCRIPTION_ENDPOINT: undefined,
      };
      mockGetConfig.mockResolvedValue(null);
      const { seedServerConfig } = await import("@norish/api/startup/seed-config");

      // Act
      await seedServerConfig();

      // Assert
      expect(videoCall()).toBeUndefined();
    });
  });
});
