import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listModels } from "../../../src/ai/providers/listing.ts";

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

describe("listModels — deepseek default model surfacing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("merges the v4 default ids with the live /models result (de-duped, sorted)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ id: "deepseek-chat" }] }));

    vi.stubGlobal("fetch", fetchMock);

    const models = await listModels("deepseek", { apiKey: "sk-test" });
    const ids = models.map((m) => m.id);

    expect(ids).toContain("deepseek-chat");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("deepseek-v4-flash");
    // sorted ascending by id
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    // hit the deepseek models endpoint with a bearer token
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.deepseek.com/models");
  });

  it("does not duplicate a v4 id already returned by the live API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ data: [{ id: "deepseek-v4-pro" }] }));

    vi.stubGlobal("fetch", fetchMock);

    const ids = (await listModels("deepseek", { apiKey: "sk-test" })).map((m) => m.id);

    expect(ids.filter((id) => id === "deepseek-v4-pro")).toHaveLength(1);
    expect(ids).toContain("deepseek-v4-flash");
  });

  it("returns [] (no fetch) when no api key is provided", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const models = await listModels("deepseek", {});

    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
