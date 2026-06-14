import { describe, expect, it } from "vitest";

import { createModelsFromConfig } from "../../../src/ai/providers/factory.ts";

describe("createModelsFromConfig — deepseek dispatch", () => {
  it("builds a DeepSeek ModelConfig for a v4 model id (no network — construction is lazy)", () => {
    const result = createModelsFromConfig({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKey: "sk-test",
      timeoutMs: 1000,
    });

    expect(result.providerName).toBe("DeepSeek");
    expect(result.model).toBeTruthy();
    expect(result.visionModel).toBeTruthy();
  });

  it("uses the requested v4 model id for the primary model", () => {
    const result = createModelsFromConfig({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "sk-test",
      timeoutMs: 1000,
    });

    // The factory always returns the AI-SDK model object (never a bare string id),
    // so .modelId is present and reflects the requested id passed through to the provider.
    expect(typeof result.model).toBe("object");
    expect((result.model as { modelId: string }).modelId).toBe("deepseek-v4-flash");
  });

  it("throws when the DeepSeek API key is missing", () => {
    expect(() =>
      createModelsFromConfig({
        provider: "deepseek",
        model: "deepseek-v4-pro",
        timeoutMs: 1000,
      })
    ).toThrow(/API Key is required for DeepSeek/);
  });
});
