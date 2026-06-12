// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteAuthTokenDecryptedDto } from "@norish/shared/contracts/dto/site-auth-tokens";

const mockServerConfig: { CAMOFOX_URL: string; CAMOFOX_API_KEY?: string } = {
  CAMOFOX_URL: "http://camofox:9377",
  CAMOFOX_API_KEY: undefined,
};

vi.mock("@norish/config/env-config-server", () => ({
  SERVER_CONFIG: mockServerConfig,
}));

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};

vi.mock("@norish/shared-server/logger", () => ({
  parserLogger: mockLogger,
  redactUrl: (value: string) => value,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const READY_HTML = `<html><head></head><body>${"x".repeat(600)}</body></html>`;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a fetch mock that routes Camoufox REST calls by path + evaluated
 * expression so the open -> wait -> evaluate -> delete flow resolves.
 */
function makeCamofoxFetchMock(options?: { html?: string; title?: string }) {
  const html = options?.html ?? READY_HTML;
  const title = options?.title ?? "Test Recipe";

  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as { expression?: string }) : {};

    if (url.endsWith("/cookies")) return jsonResponse({ ok: true, count: 1 });
    if (url.endsWith("/tabs/open")) {
      return jsonResponse({ ok: true, targetId: "tab-1", url: "https://example.com/recipe", title });
    }
    if (url.endsWith("/act")) return jsonResponse({ ok: true });
    if (url.endsWith("/evaluate")) {
      if (body.expression?.includes("readyState")) {
        return jsonResponse({
          ok: true,
          result: JSON.stringify({
            ready: "complete",
            hasRecipeLd: true,
            len: html.length,
            title,
          }),
        });
      }
      if (body.expression === "document.location.href") {
        return jsonResponse({ ok: true, result: "https://example.com/recipe" });
      }

      return jsonResponse({ ok: true, result: html });
    }
    if (init?.method === "DELETE") return jsonResponse({ ok: true });

    throw new Error(`Unexpected Camoufox call: ${url}`);
  });
}

function makeToken(
  overrides: Partial<SiteAuthTokenDecryptedDto> & {
    name: string;
    value: string;
    type: "header" | "cookie";
  }
): SiteAuthTokenDecryptedDto {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    userId: "user-1",
    domain: "example.com",
    version: 1,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, predicate: (url: string) => boolean) {
  return fetchMock.mock.calls.filter(([input]) => predicate(String(input)));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("fetchRenderedHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerConfig.CAMOFOX_URL = "http://camofox:9377";
    mockServerConfig.CAMOFOX_API_KEY = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens, waits, reads the rendered HTML, and closes the session", async () => {
    const fetchMock = makeCamofoxFetchMock();

    vi.stubGlobal("fetch", fetchMock);

    const { fetchRenderedHtml } = await import("@norish/api/camofox");
    const html = await fetchRenderedHtml("https://example.com/recipe");

    expect(html).toBe(READY_HTML);
    expect(callsTo(fetchMock, (u) => u.endsWith("/tabs/open"))).toHaveLength(1);

    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

    expect(deleteCalls).toHaveLength(1);
    expect(String(deleteCalls[0][0])).toMatch(/\/sessions\/norish-/);
  });

  it("injects cookie tokens with a Bearer header when an API key is configured", async () => {
    mockServerConfig.CAMOFOX_API_KEY = "secret-key";
    const fetchMock = makeCamofoxFetchMock();

    vi.stubGlobal("fetch", fetchMock);

    const tokens = [makeToken({ name: "session_id", value: "sess-abc", type: "cookie" })];

    const { fetchRenderedHtml } = await import("@norish/api/camofox");

    await fetchRenderedHtml("https://recipes.example.com/page", tokens);

    const cookieCalls = callsTo(fetchMock, (u) => u.endsWith("/cookies"));

    expect(cookieCalls).toHaveLength(1);

    const [cookieUrl, cookieInit] = cookieCalls[0];

    expect(String(cookieUrl)).toMatch(/\/sessions\/norish-.*\/cookies$/);
    expect((cookieInit?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(String(cookieInit?.body))).toEqual({
      cookies: [
        { name: "session_id", value: "sess-abc", domain: "recipes.example.com", path: "/" },
      ],
    });
  });

  it("skips cookie injection and warns when no API key is configured", async () => {
    const fetchMock = makeCamofoxFetchMock();

    vi.stubGlobal("fetch", fetchMock);

    const tokens = [makeToken({ name: "session_id", value: "sess-abc", type: "cookie" })];

    const { fetchRenderedHtml } = await import("@norish/api/camofox");
    const html = await fetchRenderedHtml("https://example.com/recipe", tokens);

    expect(html).toBe(READY_HTML);
    expect(callsTo(fetchMock, (u) => u.endsWith("/cookies"))).toHaveLength(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining("CAMOFOX_API_KEY is not configured")
    );
  });

  it("warns and skips header tokens (no per-request header support)", async () => {
    const fetchMock = makeCamofoxFetchMock();

    vi.stubGlobal("fetch", fetchMock);

    const tokens = [makeToken({ name: "Authorization", value: "Bearer abc", type: "header" })];

    const { fetchRenderedHtml } = await import("@norish/api/camofox");
    const html = await fetchRenderedHtml("https://example.com/recipe", tokens);

    expect(html).toBe(READY_HTML);
    expect(callsTo(fetchMock, (u) => u.endsWith("/cookies"))).toHaveLength(0);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining("Header auth tokens are not applied")
    );
  });

  it("returns an empty string and closes the session on a non-200 response", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === "DELETE") return jsonResponse({ ok: true });
      if (url.endsWith("/tabs/open")) return jsonResponse({ error: "boom" }, 500);

      throw new Error(`Unexpected Camoufox call: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { fetchRenderedHtml } = await import("@norish/api/camofox");
    const html = await fetchRenderedHtml("https://example.com/recipe");

    expect(html).toBe("");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Camoufox fetch failed"
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("returns an empty string when the page is blocked", async () => {
    const fetchMock = makeCamofoxFetchMock({ title: "Just a moment..." });

    vi.stubGlobal("fetch", fetchMock);

    const { fetchRenderedHtml } = await import("@norish/api/camofox");
    const html = await fetchRenderedHtml("https://example.com/recipe");

    expect(html).toBe("");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Camoufox fetch failed"
    );
  });
});
