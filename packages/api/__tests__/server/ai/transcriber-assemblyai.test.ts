// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCloudTranscriptionProvider } from "@norish/config/zod/server-config";

// --- Mocks -----------------------------------------------------------------

// Control the config loader so transcribeAudio sees an "assemblyai" provider.
const getVideoConfig = vi.fn();
const getAIConfig = vi.fn();

vi.mock("@norish/config/server-config-loader", () => ({
  getVideoConfig: (...args: unknown[]) => getVideoConfig(...args),
  getAIConfig: (...args: unknown[]) => getAIConfig(...args),
}));

// Stub createReadStream so no real file is opened (the body is never consumed
// because fetch is mocked).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    createReadStream: vi.fn(() => ({ pipe: vi.fn() }) as never),
  };
});

// Import AFTER the mocks are registered.
import { transcribeAudio } from "@norish/api/ai/transcriber";

const ASSEMBLYAI_VIDEO_CONFIG = {
  enabled: true,
  maxLengthSeconds: 120,
  maxVideoFileSize: 100 * 1024 * 1024,
  ytDlpVersion: "2025.11.12",
  transcriptionProvider: "assemblyai" as const,
  transcriptionModel: "best",
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAIConfig.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("isCloudTranscriptionProvider", () => {
  it("treats assemblyai as a cloud provider (requires an API key)", () => {
    expect(isCloudTranscriptionProvider("assemblyai")).toBe(true);
  });
});

describe("transcribeAudio - assemblyai dispatch", () => {
  it("returns AUTH_ERROR when the cloud provider has no API key (no network call)", async () => {
    getVideoConfig.mockResolvedValue({ ...ASSEMBLYAI_VIDEO_CONFIG, transcriptionApiKey: "" });
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio("/tmp/audio.mp3");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("AUTH_ERROR");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads, requests a transcript, polls, and returns the transcript text", async () => {
    getVideoConfig.mockResolvedValue({
      ...ASSEMBLYAI_VIDEO_CONFIG,
      transcriptionApiKey: "test-key",
    });

    const fetchMock = vi
      .fn()
      // 1. upload
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.assemblyai.com/upload/abc" }))
      // 2. create transcript
      .mockResolvedValueOnce(jsonResponse({ id: "transcript-1" }))
      // 3. poll -> completed
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "hello world" }));

    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const promise = transcribeAudio("/tmp/audio.mp3");

    // The poll loop sleeps 3s before its first GET — advance past it.
    await vi.advanceTimersByTimeAsync(3500);

    const result = await promise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("hello world");
    }

    // Verify the upload hit the real AssemblyAI upload endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstCallUrl = fetchMock.mock.calls[0]?.[0];

    expect(firstCallUrl).toBe("https://api.assemblyai.com/v2/upload");

    // Verify the create-transcript call carried the uploaded audio_url.
    const createBody = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as { body: string }).body
    ) as Record<string, unknown>;

    expect(createBody.audio_url).toBe("https://cdn.assemblyai.com/upload/abc");
    expect(createBody.speech_model).toBe("best");
  });

  it("returns a PROVIDER_ERROR (no create/poll) when the upload fails", async () => {
    getVideoConfig.mockResolvedValue({
      ...ASSEMBLYAI_VIDEO_CONFIG,
      transcriptionApiKey: "test-key",
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
      json: async () => ({}),
    } as unknown as Response);

    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio("/tmp/audio.mp3");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROVIDER_ERROR");
      expect(result.error).toContain("401");
    }
    // Only the upload call was made; create + poll never happened.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
