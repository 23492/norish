// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkOS provider wiring — hermetic. NO real WorkOS network: global.fetch is mocked.
// We mock the provider cache (the only input to buildWorkOSProviders) plus auth.ts's
// heavy module-load dependencies (db/redis/queue/repos/logger) so importing the auth
// barrel is side-effect-free and fast. buildWorkOSProviders is exported from auth.ts.

const mockWorkOS: {
  clientId?: string;
  apiKey?: string;
  isOverridden?: boolean;
} | null = { clientId: undefined, apiKey: undefined };

let workosCacheValue: typeof mockWorkOS = null;

vi.mock("@norish/auth/provider-cache", () => ({
  getCachedGitHubProvider: () => null,
  getCachedGoogleProvider: () => null,
  getCachedOIDCProvider: () => null,
  getCachedWorkOSProvider: () => workosCacheValue,
  getCachedOIDCClaimConfig: () => null,
  getCachedPasswordAuthEnabled: () => false,
  setAuthProviderCache: vi.fn(),
}));

// Heavy auth.ts deps — stub so importing the module does not touch a DB/redis.
vi.mock("@norish/db/drizzle", () => ({ db: {} }));
vi.mock("@norish/queue/redis/client", () => ({
  getPublisherClient: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  })),
}));
vi.mock("@norish/db/repositories/api-keys", () => ({ setApiKeyAuthService: vi.fn() }));
vi.mock("@norish/db/repositories/server-config", () => ({ setConfig: vi.fn() }));
vi.mock("@norish/db/repositories/households", () => ({
  addUserToHousehold: vi.fn(),
  createHousehold: vi.fn(),
  getHouseholdsForUser: vi.fn(async () => []),
  setActiveHousehold: vi.fn(),
}));
vi.mock("@norish/db/repositories/users", () => ({ countUsers: vi.fn(async () => 0) }));
vi.mock("@norish/config/server-config-loader", () => ({ isRegistrationEnabled: vi.fn(async () => true) }));
vi.mock("@norish/shared-server/logger", () => ({
  authLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("buildWorkOSProviders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workosCacheValue = null;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns no provider when WorkOS is not configured", async () => {
    workosCacheValue = null;
    const { buildWorkOSProviders } = await import("@norish/auth");

    expect(buildWorkOSProviders()).toEqual([]);
  });

  it("returns no provider when only the clientId is set (no apiKey)", async () => {
    workosCacheValue = { clientId: "client_123", apiKey: undefined };
    const { buildWorkOSProviders } = await import("@norish/auth");

    expect(buildWorkOSProviders()).toEqual([]);
  });

  it("builds a genericOAuth provider mapping the WorkOS API Key to the OAuth client_secret", async () => {
    workosCacheValue = { clientId: "client_123", apiKey: "sk_test_abc" };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const providers = buildWorkOSProviders();

    expect(providers).toHaveLength(1);
    const p = providers[0];

    expect(p.providerId).toBe("workos");
    expect(p.clientId).toBe("client_123");
    // The WorkOS API Key doubles as the OAuth client_secret.
    expect(p.clientSecret).toBe("sk_test_abc");
    expect(p.authorizationUrl).toBe("https://api.workos.com/user_management/authorize");
    expect(p.authorizationUrlParams).toEqual({ provider: "authkit" });
    expect(typeof p.getToken).toBe("function");
    expect(typeof p.getUserInfo).toBe("function");
  });

  it("getToken exchanges the code at the WorkOS authenticate endpoint and preserves the raw response", async () => {
    workosCacheValue = { clientId: "client_123", apiKey: "sk_test_abc" };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const workosResponse = {
      access_token: "at_xyz",
      refresh_token: "rt_xyz",
      user: { id: "user_01", email: "jane@example.com", email_verified: true },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => workosResponse,
    }));

    vi.stubGlobal("fetch", fetchMock);

    const tokens = await buildWorkOSProviders()[0].getToken({
      code: "auth_code_123",
      redirectURI: "https://norish.example.com/api/auth/oauth2/callback/workos",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.workos.com/user_management/authenticate");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);

    expect(body.client_id).toBe("client_123");
    expect(body.client_secret).toBe("sk_test_abc");
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("auth_code_123");

    expect(tokens.accessToken).toBe("at_xyz");
    expect(tokens.refreshToken).toBe("rt_xyz");
    // The full WorkOS response (incl. the user) is preserved for getUserInfo.
    expect(tokens.raw).toEqual(workosResponse);

    vi.unstubAllGlobals();
  });

  it("getToken throws when the WorkOS authenticate call fails", async () => {
    workosCacheValue = { clientId: "client_123", apiKey: "sk_test_abc" };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      buildWorkOSProviders()[0].getToken({
        code: "bad",
        redirectURI: "https://norish.example.com/api/auth/oauth2/callback/workos",
      })
    ).rejects.toThrow(/WorkOS token exchange failed: 401/);

    vi.unstubAllGlobals();
  });

  it("getUserInfo maps the WorkOS user profile to norish user fields", async () => {
    workosCacheValue = { clientId: "client_123", apiKey: "sk_test_abc" };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const user = await buildWorkOSProviders()[0].getUserInfo({
      raw: {
        user: {
          id: "user_01",
          email: "jane@example.com",
          email_verified: true,
          first_name: "Jane",
          last_name: "Doe",
          profile_picture_url: "https://img.example.com/jane.png",
        },
      },
    });

    expect(user).toEqual({
      id: "user_01",
      email: "jane@example.com",
      emailVerified: true,
      name: "Jane Doe",
      image: "https://img.example.com/jane.png",
    });
  });

  it("getUserInfo falls back to the email for the name and returns null when no user is present", async () => {
    workosCacheValue = { clientId: "client_123", apiKey: "sk_test_abc" };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const provider = buildWorkOSProviders()[0];

    // No names -> name falls back to email; unverified email -> emailVerified false; no picture -> undefined image.
    const user = await provider.getUserInfo({
      raw: { user: { id: "user_02", email: "no-name@example.com" } },
    });

    expect(user).toEqual({
      id: "user_02",
      email: "no-name@example.com",
      emailVerified: false,
      name: "no-name@example.com",
      image: undefined,
    });

    // Missing user object -> null (so better-auth surfaces "unable to get user info").
    expect(await provider.getUserInfo({ raw: {} })).toBeNull();
    expect(await provider.getUserInfo({})).toBeNull();
  });
});
